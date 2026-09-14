# Production frontend asset delivery

Production Vite builds retain canonical JavaScript and CSS files under `assets/`
and emit `.gz` companions only when gzip is smaller. Compression uses the final
output bytes during build generation, sequentially to bound transient memory.
There is no request-time compression or new compression dependency.

The companions travel with their exact build through candidate preparation,
packaging, and runtime snapshot copying. The original filenames, decoded bytes,
entry HTML and build identity remain canonical. Generation failures propagate to
the existing candidate failure path, which preserves the current serving pair.
Never add or replace compressed files inside an active immutable snapshot.

The production static handler keeps Hono's path handling, directory lookup,
content types and existing cache policy. Only GET/HEAD for built `.js`/`.css`
assets can select a regular, smaller gzip companion. APIs, WebSockets, file-link
responses, HTML/manifests, source maps, images, fonts and development serving are
outside this selection.

`Accept-Encoding` controls the response:

- Missing/empty headers select identity. Known codings and quality values are
  case-insensitive; the historical `x-gzip` token is treated as gzip.
- Gzip is selected when it is acceptable and at least as preferred as identity.
  Explicit quality values and exclusions override wildcard preferences. Identity
  remains acceptable by default unless excluded. Ties prefer gzip.
- Malformed known codings and conflicting duplicates are conservative: an
  exclusion cannot be overridden by a second positive value.
- If no smaller regular companion exists, identity is used only when acceptable;
  otherwise the response is 406.
- Range requests stay on the existing identity-file path. If identity is
  forbidden, they return 406; encoded byte-range support is not introduced.
  Existing missing-asset and conditional-request behavior remains delegated to
  the existing serving path.

Both eligible representations vary on `Accept-Encoding`, preserving an existing
Vary value or wildcard. Content type describes the canonical asset;
Content-Encoding and Content-Length describe the selected representation. An
already-present strong identity ETag is weakened for gzip rather than reused as
a strong byte validator. No new cache lifetime or validator is introduced.
Entry HTML stays `Cache-Control: no-store` and existing portrait cache rules stay
unchanged. A rejected request or missing asset is never mislabeled as gzip HTML.

Source delivery and activation are separate. The compatible-build checks and
prebuild-before-restart protocol still govern any production change. An approved
activation must load the new frontend, and the first new-build/cache state must
be distinguished from a later ordinary or long-idle return.

Use the existing bounded `entry_resources` diagnostic to compare encoded and
decoded body sizes and resource-completion versus startup/frame boundaries.
Gzip can reduce delivery bytes; it does not eliminate decoded-code processing,
conversation loading, OS startup, or unmeasured icon-tap/physical-pixel time.
Intermediaries can affect negotiation and delivery. Isolated build/HTTP/browser
validation does not establish improvement on the phone's actual access path.
