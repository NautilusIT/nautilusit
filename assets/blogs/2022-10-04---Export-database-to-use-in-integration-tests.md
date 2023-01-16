# Export database to use in integration tests

The post demonstrates how to use a database export in API integration tests.

![Scheme of database and API pipeline](assets/blogs/images/db-api-pipeline.jpg "Scheme of database and API pipeline")
*Pipelines of the database and api showing the 5 high level steps in using a LocalDb to run integration tests of an API.*

## Motivation to use LocalDb

For the integration tests of the API I wanted to have a connection to a database to test the full API flow from the http call to the actual queries and commands. An in-memory database is not sufficient as this database provider has blocking limitions, such as:

* No awareness of relations between entities.
* No support for stored procedures.

[SQL Server Express LocalDb](https://learn.microsoft.com/en-us/sql/database-engine/configure-windows/sql-server-express-localdb?view=sql-server-2017) does not have these limitations, as it relies also on the SQL Server Database Engine. It has some other limitations, but none relevant for my use case.

LocalDb is easily accessible in an Azure Pipeline Agent:

```yaml
pool:
  vmImage: 'windows-latest'

...

- task: PowerShell@2
  displayName: Use LocalDb
  inputs:
    targetType: inline
    script: sqllocaldb start mydb
```

## Get the database

After applying the latest changes and migrations in the database (step 1), the database is exported (step 2). In the current design the database and the API are seperated services.

```yaml
- task: SqlAzureDacpacDeployment@1
  inputs:
    azureSubscription: servicePrincipal
    serverName: sqlServerName
    databaseName: mydb
    sqlUsername: username
    sqlPassword: password
    deployType: DacpacTask
    DeploymentAction: Export
    IpDetectionMethod: AutoDetect

- task: CopyFiles@2
  displayName: Copy bacpac file ArtifactStagingDirectory
  inputs:
    sourceFolder: $(build.sourcesDirectory)
    contents: "**/*.bacpac"
    targetFolder: $(build.artifactStagingDirectory)
    flattenFolders: true

- task: PublishBuildArtifacts@1
  displayName: Publish database backup
  inputs:
    artifactName: mydb
```

The database can be used in the API pipeline.

## Find and import database asset

To find the database asset was not that straightforward, as the build only completes after executing migrations in production. The integration tests need to run before, e.g. when API a new feature has an open pull request.

![Database release pipeline](assets/blogs/images/release-pipeline.jpg "Database release pipeline")
*Database release pipeline completes after releasing to production, while we the database export before to run the integration tests.*

We are interested in the `BuildId` that completed the test stage last. We cannot use the [latest build](https://learn.microsoft.com/en-us/rest/api/azure/devops/build/latest/get?view=azure-devops-rest-6.0) as it returns the latest completed build pipelines.

Below you find the script to retrieve the latest build which completed a specific stage.

```yaml
- task: PowerShell@2
  displayName: Set BuildId of latest ${{ parameters.solutionName }} database
  inputs:
    targetType: inline
    pwsh: true
    script: |
      # Get latest build sorted by time:
      $Url="$(System.TeamFoundationCollectionUri)/$(System.TeamProject)/_apis/build/builds?definitions=${{parameters.databaseReleasePipelineId}}&api-version=6.1"
      $Result = Invoke-RestMethod -Uri $Url -Headers @{authorization = "Bearer $(System.AccessToken)"} -Method Get
      $Result.value = $Result.value | Sort-Object queueTime -Descending

      foreach ($Build in $Result.value)
      {
        # Find the timeline of the stage of each build:
        $Result = Invoke-RestMethod -Uri $Build._links.timeline.href -Headers @{authorization = "Bearer $(System.AccessToken)"} -Method Get

        # Get the stage that completed 'Test' and set $Build.id:
        $TestStage = $Result.records | where {$_.type -eq "Stage" -and $_.identifier -eq "Test"}
        if ($TestStage.result -eq "succeeded"){
          $BuildId = $Build.id
          Write-Host "##[command] Using BuildId: $($BuildId)."
          echo "##vso[task.setvariable variable=BuildId]$BuildId"
          break
        }
      }
      if (!$BuildId){
        Write-Host "##[error] No build found with a succeeded Test Stage."
      }
```

After getting the `BuildId`, we can download the artifact (step 3).

```yaml
  - task: DownloadPipelineArtifact@2
    displayName: Download latest database
    inputs:
      source: specific
      project: $(System.TeamProjectId)
      pipeline: databasePipelineId
      runVersion: specific
      buildId: $(BuildId)
      path: $(Pipeline.Workspace)
      allowPartiallySucceededBuilds: true
      checkDownloadedFiles: true
```

[MartinCostello's `sqlLocalDbApi`](https://github.com/martincostello/sqllocaldb) has an excellant interface to configure the database, attach the backup and import the data (step 4). Roughly, the flow looks like:

```csharp
using MartinCostello.SqlLocalDb;
using Microsoft.SqlServer.Dac;

// Create database.
using var localDB = new SqlLocalDbApi();
sqlLocalDbApi.GetOrCreateInstance(instanceName);
sqlLocalDbApi.StartInstance(instanceName);
var instance = sqlLocalDbApi.GetInstanceInfo(instanceName);

// Import database.
var options = new DacImportOptions
{
    CommandTimeout = 120,
    ImportContributors = typeof(DbCreateDatabaseModifier).FullName,
    ImportContributorArguments = $"{DbCreateDatabaseModifier.MdfFilePathArg}={dataFilePath};{DbCreateDatabaseModifier.LdfFilePathArg}={logFilePath}",
};
var package = BacPackage.Load(databasePath);
var service = new DacServices(connectionString);
service.ImportBacpac(package, databaseName, options);
```

In the integration test `appsettings.json`, we need to set the  connection string to the new database.

```json
{
  "ConnectionStrings": {
    "DbContext": "Data Source=(localdb)\\mydb;Initial Catalog=mydb;Integrated Security=SSPI;Application Name=mydb"
  }
}
```

The database is hosted in the pipeline agent itself. Now you are all set up to run your integration tests using a test database (step 5).

## References

* [LocalDb documentation.](https://learn.microsoft.com/en-us/sql/database-engine/configure-windows/sql-server-express-localdb?view=sql-server-2017)
* [Using SQL Server Express LocalDB in Azure DevOps.](https://www.jannikbuschke.de/blog/azure-devops-enable-mssqllocaldb/)
* [Azure's Build REST API documentation.](https://learn.microsoft.com/en-us/rest/api/azure/devops/build/?view=azure-devops-rest-6.0)
* [MartinCostello's `sqlLocalDbApi` package.](https://github.com/martincostello/sqllocaldb)
