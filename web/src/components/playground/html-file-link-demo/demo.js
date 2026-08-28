const setStatus = (id, value) => {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
};

setStatus("script-status", "loaded");
setStatus("opener-status", window.opener === null ? "isolated" : "unexpectedly available");

fetch("./data.json")
  .then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  })
  .then((data) => setStatus("asset-status", data.message))
  .catch((error) => setStatus("asset-status", `failed: ${error.message}`));

fetch("/api/settings")
  .then((response) => setStatus("api-status", `unexpected HTTP ${response.status}`))
  .catch(() => setStatus("api-status", "blocked"));
