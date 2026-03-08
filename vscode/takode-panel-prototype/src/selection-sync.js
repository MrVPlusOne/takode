"use strict";

const REQUEST_TIMEOUT_MS = 4000;

function normalizeBaseUrlForApi(baseUrl) {
  const url = new URL(String(baseUrl));
  url.search = "";
  url.hash = "";
  return url.toString();
}

function getSelectionApiUrl(baseUrl) {
  const url = new URL(normalizeBaseUrlForApi(baseUrl));
  const prefix = url.pathname.replace(/\/$/, "");
  url.pathname = `${prefix}/api/vscode/selection`;
  return url.toString();
}

function dedupeBaseUrls(baseUrls) {
  const out = [];
  const seen = new Set();
  for (const baseUrl of baseUrls || []) {
    if (typeof baseUrl !== "string" || !baseUrl) {
      continue;
    }
    const apiUrl = getSelectionApiUrl(baseUrl);
    if (seen.has(apiUrl)) continue;
    seen.add(apiUrl);
    out.push(apiUrl);
  }
  return out;
}

function buildSelectionSyncPayload(selection, sourceInfo, updatedAt = Date.now()) {
  return {
    selection: selection
      ? {
        absolutePath: selection.absolutePath,
        startLine: selection.startLine,
        endLine: selection.endLine,
        lineCount: selection.lineCount,
      }
      : null,
    updatedAt,
    sourceId: sourceInfo.sourceId,
    sourceType: sourceInfo.sourceType,
    ...(sourceInfo.sourceLabel ? { sourceLabel: sourceInfo.sourceLabel } : {}),
  };
}

function getPublishFingerprint(selection, sourceInfo, apiUrls) {
  return JSON.stringify({
    selection: selection
      ? {
        absolutePath: selection.absolutePath,
        startLine: selection.startLine,
        endLine: selection.endLine,
        lineCount: selection.lineCount,
      }
      : null,
    sourceId: sourceInfo.sourceId,
    sourceType: sourceInfo.sourceType,
    sourceLabel: sourceInfo.sourceLabel || null,
    apiUrls,
  });
}

function createSelectionSyncManager({
  fetchImpl = fetch,
  getBaseUrls,
  getSourceInfo,
  logDebug = () => {},
}) {
  let lastFingerprint = null;

  async function publishSelection(selection, options = {}) {
    const sourceInfo = getSourceInfo();
    const apiUrls = dedupeBaseUrls(getBaseUrls());
    const fingerprint = getPublishFingerprint(selection, sourceInfo, apiUrls);
    if (!options.force && fingerprint === lastFingerprint) {
      return false;
    }
    lastFingerprint = fingerprint;

    if (apiUrls.length === 0) {
      logDebug("selectionSync skipped: no configured base URLs");
      return false;
    }

    const payload = buildSelectionSyncPayload(selection, sourceInfo, Date.now());
    await Promise.all(apiUrls.map(async (apiUrl) => {
      try {
        const response = await fetchImpl(apiUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) {
          logDebug("selectionSync publish failed", { apiUrl, status: response.status });
        }
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        logDebug("selectionSync publish error", { apiUrl, error: text });
      }
    }));

    return true;
  }

  return {
    publishSelection,
    buildSelectionSyncPayload: (selection) => buildSelectionSyncPayload(selection, getSourceInfo(), Date.now()),
  };
}

module.exports = {
  REQUEST_TIMEOUT_MS,
  getSelectionApiUrl,
  buildSelectionSyncPayload,
  createSelectionSyncManager,
};
