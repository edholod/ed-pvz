# Ivideon archive studio — verification status, 2026-11-19

NOT READY FOR OWNER RELEASE. ARCHIVE_EXPORT_ENABLED=false on both services.
The account connection, camera aliases/PVZ mappings and saved clip queue remain intact.

## Implemented

Named multi-camera clip queue in the owner account, timeline/date inputs, playback
frame selection, MP4/JPEG file cards, rename, signed download, native destination
picker with mobile download/share fallback, source/1080/720/480 resolution conversion,
15-minute adaptive chunk processing and FFmpeg concat. OAuth/cloud-upload handlers
are implemented but neither provider application is configured or live-tested.

Archive previews use prepared H.264/AAC MP4, avoiding the failed HLS ingestion path.
Quality labels denote output resolution, not an improvement in camera detail.

## Deployment

Dedicated free Render service: edpvz-archive, Oregon, srv-dbv9nau7bikc7380ag30.
URL: https://edpvz-archive.onrender.com
Docker context: repository root; Dockerfile: services/archive-worker/Dockerfile.
Auto-deploy off to avoid losing temporary files with unrelated site changes.
Frontend archive requests now point to this service; the existing collector retains
its unrelated functions. Its archive submission flag is also disabled.

Required server environment: SUPABASE_URL, publishable SUPABASE_ANON_KEY (or existing
public fallback), stable private ARCHIVE_SIGNING_KEY, ARCHIVE_PUBLIC_URL.
Enable ARCHIVE_EXPORT_ENABLED only after end-to-end file transfer and correct
source time mapping pass. Health exportReady controls browser job submission.

## Actual checks and unresolved blockers

Direct authenticated provider API exports succeeded for all three non-USB cameras.
Complete MP4 downloads from the local diagnostic environment succeeded:
warehouse 517646 bytes; camera 6221F 540853 bytes; screen 130080 bytes.
The provider files are H.264; their video durations for a requested five seconds
were approximately 6.8, 7.187 and 6.413 seconds. Camera 6221F's first OSD frame
showed 23:25:09 for a requested start of 23:25:10 Moscow. Export metadata still
reported the requested start/end, so it does not supply the true frame offset.

The earlier trim-from-zero implementation produced a locally playable 5.005-second
720p file, but this is NOT proof of correct wall-clock boundaries. It has been
replaced with a source-duration guard: shifted/padded sources are rejected rather
than silently trimmed or concatenated. That guard rejects the real sample.
An accurate provider frame-to-wall-clock mapping remains necessary for exact cuts.

Production tests on both Render services failed receiving the complete media body.
Ivideon export creation and ready status succeeded. HTTP/2 received HTTP200 headers,
then timed out waiting for the body. HTTP/1.1 fallback also timed out. Direct provider
and encrypted Supabase MP4 relay paths were tested, including full GET without Range.
Changing services/region did not establish working production ingestion.
No successful production MP4 file/download or iOS playback test is asserted.

Synthetic FFmpeg checks passed: adjacent concat, four seconds/100 frames, duration
validation, no upscaling, short-source rejection, padded-source rejection, JPEG
extraction/download. Security checks passed: authorization, owner isolation,
expiring signed links, downloaded byte equality, invalid JPEG rejection.
Run: python tests/test_archive_processing.py; python tests/test_archive_security.py.
These are executable assertion scripts, not unittest-discover test cases.

## Cloud configuration still required

Yandex developer registration opens an account sign-in page in the cloud browser.
Google Cloud console currently renders Site Unavailable in that browser.
No OAuth clients, consent grants or cloud saves were created/verified.
Do not reuse another product's OAuth client IDs or connector credentials.

Callbacks:
https://edpvz-archive.onrender.com/archive/cloud/google/callback
https://edpvz-archive.onrender.com/archive/cloud/yandex/callback
Google variables: ARCHIVE_GOOGLE_CLIENT_ID, ARCHIVE_GOOGLE_CLIENT_SECRET.
Google scope: https://www.googleapis.com/auth/drive.file
Yandex variables: ARCHIVE_YANDEX_CLIENT_ID, ARCHIVE_YANDEX_CLIENT_SECRET.
Yandex scopes in current implementation: cloud_api:disk.write cloud_api:disk.info.
Tokens are encrypted with a key derived from ARCHIVE_SIGNING_KEY and stored under
each owner's RLS scope. Cloud callbacks/uploads need live provider verification.

## Operational limits

Job state and files are temporary, single-instance, cleaned after 24 hours on
subsequent requests; service restarts lose jobs/files. Queue metadata is saved in
the account. Up to 50 clips/request, two active requests/owner, ten active globally,
processing serialized. No clip-duration cap in app code, but disk/CPU/provider/auth
limits remain. Long exports cannot be promised independently of provider footage,
plan limits, missing recordings or token expiry. There is no automatic recovery
across restarts or a closed tab's expired session. Production release needs durable
job state/private storage and scoped long-running authorization.

Desktop destination picker requires supporting browsers. iOS uses normal downloads
or share sheet; a website cannot select an arbitrary filesystem path silently.
Physical iPhone/Safari and long real multi-piece exports remain unverified.
