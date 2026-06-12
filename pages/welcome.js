// ClearHead — welcome page. Opens settings; nothing is stored here.
document.getElementById("openSettings").addEventListener("click", () => {
  if (chrome.runtime?.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.location.href = "options.html";
  }
});
