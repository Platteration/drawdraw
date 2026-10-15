# Privacy disclosure working notes

These notes apply to the current free build and must be checked against the final signed artifacts and any later SDK additions.

| Data/use | Observed current implementation |
| --- | --- |
| Portrait images | Copied into local app storage; edited locally; no app upload client found. |
| Guide/project settings | Stored in local AsyncStorage; no app server or account. |
| Recovery snapshots | Local originals of partly corrupt project indexes, including guide settings and image references; removable from Home. |
| Camera | Requested only for taking a photo. |
| Photo selection | System picker grants access to a selected image. |
| Photo export | Write/add-only permission where required; user-selected system sharing. |
| Temporary exports | Save/choice cancellation and returned iOS sharing release captures; Android shared captures remain in cache for recipient access and library/OS cleanup. |
| Advertising/tracking | No advertising, tracking, or app analytics integration found. |
| Purchases | Unavailable; add store/provider data practices before a paid release. |
| OS backup | May retain app data according to device backup settings. |
| Support | Publisher receives whatever a user voluntarily sends; contact and retention terms remain to be supplied. |

The store definitions of collection, sharing, and required-reason APIs are separate. Local-only processing is not evidence that every store question can be answered without reviewing the final app and its integrated native SDKs. Native dependencies already ship privacy manifests; verify their final aggregation in an iOS archive. Check the Android merged manifest for the actual permissions in the intended release variant.
