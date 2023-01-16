# Create a timeseries application with Azure Data Explorer

This article is a first introduction to [Azure Data Explorer](https://azure.microsoft.com/en-us/services/data-explorer/)(ADX) for querying timeseries data in a simple .NET application. Handling timeseries becomes more an more valuable. Both monitoring our own assets as developers, but also assets of our clients in the IoT realm.

The reason to explore this product is that it is a columnar database, which is ideal for timeseries storage. Also it supports many timeseries-related functions, such as simple aggregations over time and also more advanced anomaly detection within a timeseries. Azure Data Explorer is also used by Azure to monitor performance of the resources (also by Skype, LinkedIn, Office Bing etc.), which to me is a good sign it is used that much internally. All the timeserie plots you see in the Azure portal are serviced by Azure Data Explorer. It moved to GA in 2019. There are also higher level products available, which are build on top of ADX, such as [Azure TimeSeries Insights](https://azure.microsoft.com/en-us/services/time-series-insights/), [Log Analytics](https://docs.microsoft.com/en-us/azure/azure-monitor/logs/log-analytics-tutorial), [Application Insights](https://docs.microsoft.com/en-us/azure/azure-monitor/app/app-insights-overview). ADX was previously known as Kusto.

ADX vision: Be the ideal tool to analyze high volumes of fresh and historical data in the cloud:

* High-performance analytics service
* Own query language (KQL)
* Powerful ingestion
* Supports structured, semi-structured and unstructured data
* Fully managed (e.g. auto-scaling, indexing)
* Possible to link to various dashboards for data exploration (e.g. Power BI, Grafana)

![Azure Data Explorer architecture](assets/blogs/images/adx-architecture.jpg "Azure Data Explorer architecture")
*The architecture of ADX shows the ingestion (left) and the data retrieval using KQL (right). The data can be ingested using batches and stream of data. Internally there is a `Data Management` service, which checks the various sources for new data to be ingested and a `Engine`, which stores the actual data after caching it on a SSD. The queries are also handled by the Engine. Adjusted from [a PluralSight course](https://app.pluralsight.com/course-player?clipId=80b5669e-75c9-4fec-950b-e75b978bcbc6) by [Xavier Morera](https://twitter.com/xmorera?ref_src=twsrc%5Egoogle%7Ctwcamp%5Eserp%7Ctwgr%5Eauthor)*

The code in this article is available on [github](https://github.com/jonnekleijer/TimeSeriesApp).

## Prerequisites

* [dotnet cli](https://docs.microsoft.com/en-us/dotnet/core/tools/) to create new .NET projects
* [postman](https://www.postman.com/) to test the api calls
* [visual studio](https://visualstudio.microsoft.com/) or another IDE

## Setup

Create an app based on the `webapi` template.

```shell
mkdir AzureDataExplorerApp
cd AzureDataExplorerApp
dotnet new "webapi" -f net5.0
```

First we add a simple structure to the application using the [mediator pattern](https://github.com/jbogard/MediatR/tree/master/src/MediatR). In short we have `Controllers` calling `Services` and `Services` using `Queries` for retrieval of data and `Commands` for storing new and updated data. When splitting these concerns, we end up with the following project structure:

![Project structure](assets/blogs/images/timeseriesapp-project-structure.jpg "Project structure")
*Project structure.*

## Timeserie Controller

We start with the controller. To query the timeseries data we use an `assetId` as a path parameter and `start` and `end` as query parameters. The `TimeSeriesService` is injected via DI.

```csharp
[ApiController]
[Route("[controller]")]
public class TimeSeriesController : ControllerBase
{
    private readonly ITimeSeriesService _timeSeriesService;

    public TimeSeriesController(ITimeSeriesService timeSeriesService)
    {
        _timeSeriesService = timeSeriesService;
    }

    [HttpGet("{assetId}")]
    public async Task<ICollection<TimeSerieValueModel>> Get(string assetId, DateTime start, DateTime end)
    {
        return await _timeSeriesService.GetTimeSeries(assetId, start, end);
    }
}
```

## Timeserie Service

In the `TimeSeriesService` we define a method to query our timeseries data. As this is the service layer, we define our business logic here. In this case we want to limit the amount of data returned by our api by validating on the period of data that's being requested. So for example, when the user requests data for more than 30 days, we return a timeserie value aggregated for each day. This logic can be overruled by the user by supplying an interval.

```csharp
public async Task<ICollection<TimeSerieValueModel>> GetTimeSeries(string assetId, DateTime start, DateTime end, double interval)
{
    if (interval == 0)
    {
        var period = end - start;
        interval = CalculateInterval(period);
    }

    return await Mediator.Send(new GetTimeSeriesRequestModel {
        AssetId = assetId, Start = start, End = end, Interval = interval
    });
}

private static double CalculateInterval(TimeSpan period)
{
    double interval;
    if (period > new TimeSpan(30, 0, 0, 0))
    {
        interval = new TimeSpan(1, 0, 0, 0).TotalSeconds;
    }
    else if (period > new TimeSpan(7, 0, 0, 0))
    {
        interval = new TimeSpan(1, 0, 0).TotalSeconds;
    }
    else
    {
        interval = new TimeSpan(0, 5, 0).TotalSeconds;
    }

    return interval;
}
```

## Timeserie Query

The request model used by the query, where the aggregate interval is being set by the service:

```csharp
public record GetTimeSeriesRequestModel : IRequest<ICollection<TimeSerieValueModel>>
{
    public string AssetId;
    public DateTime Start;
    public DateTime End;
    public double Interval;
}
```

Here the actual fun starts, as we can query the Azure Data Explorer cluster. There is a "[Samples](https://dataexplorer.azure.com/clusters/help/databases/Samples)" db on the trail cluster. The [SDK](https://docs.microsoft.com/en-us/azure/data-explorer/kusto/api/netfx/about-kusto-data) support sending queries to the database. The SDK does not have an object model, so we have to send the kql queries as a strings unfortunately.

A few things to note:

* Unlike other dbs, there is no primary, foreign key, or unique constraints.
* Make sure the db request is in ISO 8601 to prevent timezone issues: (e.g. add Z) if the clusteris not on utc.
* When applying summerize bin, the returned results are consistent to the bin itself. So if we request a datapoint every hour and we start the query at 5 past, the first returned datetime is the next hour (i.e. ceiled).
* We aggregate by using an average. There are [many more](https://docs.microsoft.com/en-us/azure/data-explorer/kusto/query/summarizeoperator#list-of-aggregation-functions) available aggregate options.

```csharp
protected override ICollection<TimeSerieValueModel> Handle(GetTimeSeriesRequestModel request)
{
    const string Cluster = "https://help.kusto.windows.net";
    const string Database = "Samples";

    var connectionBuilder = new KustoConnectionStringBuilder(Cluster, Database).WithAadAzCliAuthentication();

    using var queryProvider = KustoClientFactory.CreateCslQueryProvider(connectionBuilder);
    var query = $"SamplePowerRequirementHistorizedData" +
        $"| where twinId == '{request.AssetId}'" +
        $"| where timestamp between (datetime('{request.Start:yyyy-MM-ddTHH:mm:ss}Z') .. datetime('{request.End:yyyy-MM-ddTHH:mm:ss}Z'))" +
        $"| summarize avg(value) by bin(timestamp, {request.Interval}s)";

    var requestId = Guid.NewGuid().ToString();
    var clientRequestProperties = new ClientRequestProperties() { ClientRequestId = requestId };

    using var reader = queryProvider.ExecuteQuery(query, clientRequestProperties);
    var timeSeries = new List<TimeSerieValueModel>();
    while (reader.Read())
    {
        var timeSerieValue = new TimeSerieValueModel {
            DateTime = reader.GetDateTime(0),
            Value = reader.GetDouble(1)
        };
        timeSeries.Add(timeSerieValue);
    }
    return timeSeries;
}
```

When running the application, you test our newly created endpoint with a client, for example Postman:

```shell
https://localhost:5001/TimeSeries/:assetId?start=2021-03-01T01:01&end=2021-04-02
```

![Timeseries postman call](assets/blogs/images/timeseries-postman.jpg "Timeseries postman call")
*The postman call returns an example request When you run the application you can use an API*

## Summary

The code is available on [github](https://github.com/jonnekleijer/TimeSeriesApp).

Here we showed an example on how to link Azure Data Explorer to a C# client and build your own custom logic on top of ADX. We've seen we don't require to precalculate aggregates, which makes this a flexible database for timeserie analysis. Sending queries using the C# client library only supports using strings and there is not an object model to build up your queries, which makes it a bit less developer friendly.

Some next steps might be:

* Explore More advanced KQL queries
* Ingest data
* Manage our own Azure Data Explorer resources (e.g # of clusters)
* Add a user interface to explore the timeseries

## References

* [Homepage of Azure Data Explorer](https://azure.microsoft.com/en-us/services/data-explorer/)
* [Sample database](https://dataexplorer.azure.com/clusters/help/databases/Samples)
* [Client Library](https://docs.microsoft.com/en-us/azure/data-explorer/kusto/api/netfx/about-kusto-data)
* [Introduction to ADX on Pluralsight](https://app.pluralsight.com/library/courses/microsoft-azure-data-explorer-starting/table-of-contents)
