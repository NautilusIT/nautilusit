"use strict";

// element toggle function
const elementToggleFunc = function (elem) {
  elem.classList.toggle("active");
};

// sidebar variables
const sidebar = document.querySelector("[data-sidebar]");
const sidebarBtn = document.querySelector("[data-sidebar-btn]");

// sidebar toggle functionality for mobile — also toggle aria-expanded + button label
if (sidebar && sidebarBtn) {
  const sidebarBtnLabel = sidebarBtn.querySelector("span");
  sidebarBtn.setAttribute("aria-expanded", "false");
  sidebarBtn.addEventListener("click", function () {
    elementToggleFunc(sidebar);
    const expanded = sidebar.classList.contains("active");
    sidebarBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
    if (sidebarBtnLabel) {
      sidebarBtnLabel.textContent = expanded ? "Hide Contacts" : "Show Contacts";
    }
  });
}

// testimonials variables
const testimonialsItem = document.querySelectorAll("[data-testimonials-item]");
const modalContainer = document.querySelector("[data-modal-container]");
const modalCloseBtn = document.querySelector("[data-modal-close-btn]");
const overlay = document.querySelector("[data-overlay]");

// modal variable
const modalImg = document.querySelector("[data-modal-img]");
const modalTitle = document.querySelector("[data-modal-title]");
const modalText = document.querySelector("[data-modal-text]");

// modal toggle function — only wires up if both container and overlay exist
if (modalContainer && overlay) {
  const testimonialsModalFunc = function () {
    modalContainer.classList.toggle("active");
    overlay.classList.toggle("active");
  };

  for (let i = 0; i < testimonialsItem.length; i++) {
    testimonialsItem[i].addEventListener("click", function () {
      modalImg.src = this.querySelector("[data-testimonials-avatar]").src;
      modalImg.alt = this.querySelector("[data-testimonials-avatar]").alt;
      modalTitle.innerHTML = this.querySelector(
        "[data-testimonials-title]"
      ).innerHTML;
      modalText.innerHTML = this.querySelector(
        "[data-testimonials-text]"
      ).innerHTML;

      testimonialsModalFunc();
    });
  }

  if (modalCloseBtn) modalCloseBtn.addEventListener("click", testimonialsModalFunc);
  overlay.addEventListener("click", testimonialsModalFunc);
}

// custom select variables (projects filter — guarded in case projects section is removed)
const select = document.querySelector("[data-select]");
const selectItems = document.querySelectorAll("[data-select-item]");
const selectValue = document.querySelector("[data-selecct-value]");
const filterBtn = document.querySelectorAll("[data-filter-btn]");
const filterItems = document.querySelectorAll("[data-filter-item]");

const filterFunc = function (selectedValue) {
  for (let i = 0; i < filterItems.length; i++) {
    if (selectedValue === "all") {
      filterItems[i].classList.add("active");
    } else if (selectedValue === filterItems[i].dataset.category) {
      filterItems[i].classList.add("active");
    } else {
      filterItems[i].classList.remove("active");
    }
  }
};

if (select) {
  select.addEventListener("click", function () {
    elementToggleFunc(this);
  });

  for (let i = 0; i < selectItems.length; i++) {
    selectItems[i].addEventListener("click", function () {
      let selectedValue = this.innerText.toLowerCase();
      if (selectValue) selectValue.innerText = this.innerText;
      elementToggleFunc(select);
      filterFunc(selectedValue);
    });
  }
}

// add event in all filter button items for large screen
if (filterBtn.length > 0) {
  let lastClickedBtn = filterBtn[0];

  for (let i = 0; i < filterBtn.length; i++) {
    filterBtn[i].addEventListener("click", function () {
      let selectedValue = this.innerText.toLowerCase();
      if (selectValue) selectValue.innerText = this.innerText;
      filterFunc(selectedValue);

      lastClickedBtn.classList.remove("active");
      this.classList.add("active");
      lastClickedBtn = this;
    });
  }
}

// page navigation variables
const navigationLinks = document.querySelectorAll("[data-nav-link]");
const pages = document.querySelectorAll("[data-page]");

// add event to all nav link
for (let i = 0; i < navigationLinks.length; i++) {
  navigationLinks[i].addEventListener("click", function () {
    for (let i = 0; i < pages.length; i++) {
      let navigateTo = this.getAttribute("data-to");
      if (navigateTo === pages[i].dataset.page) {
        if (navigateTo === "blog-article") {
          getArticleFunc(this.getAttribute("data-article"));
        }
        pages[i].classList.add("active");
        navigationLinks[i].classList.add("active");
        window.scrollTo(0, 0);
      } else {
        pages[i].classList.remove("active");
        navigationLinks[i].classList.remove("active");
      }
    }
  });
}

const getArticleFunc = function (article) {
  return fetch(article)
    .then((response) => response.text())
    .then((text) => {
      marked.setOptions({
        highlight: function (code, lang) {
          // Defence in depth: hljs's "common" bundle registers some languages as
          // aliases without shipping the grammar (e.g. http in 11.7.0), so even
          // after a getLanguage check, hljs.highlight can still throw. Fall back
          // to highlightAuto on any failure so a bad fence never blanks the post.
          try {
            if (lang && hljs.getLanguage(lang)) {
              return hljs.highlight(code, {
                language: lang,
                ignoreIllegals: true,
              }).value;
            }
          } catch (_) { /* fall through */ }
          try {
            return hljs.highlightAuto(code).value;
          } catch (_) {
            return code;
          }
        },
      });
      document.getElementById("blog-post-detail").innerHTML = marked.marked(text);
    });
};
