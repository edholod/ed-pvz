# Ivideon archive studio

The archive router is mounted at `/archive` in the existing FastAPI service.
The browser module is `apps/surveillance/archive-studio.mjs`.

## Server readiness

`GET /archive/health` must return `ok: true, version: 2` before preparing files.
The browser checks this capability before submitting export or frame jobs.
Existing live-view, stored Ivideon connection, camera aliases and PVZ assignments
continue to use the existing edge function and account data.

Required environment:

- `SUPABASE_URL` and `SUPABASE_ANON_KEY` for owner authentication/RLS.
- `ARCHIVE_SIGNING_KEY`: stable random server secret, also derives the cloud-token
  encryption key. Do not rotate without planning reconnects for cloud accounts.
- `ARCHIVE_WORK_DIR`: defaults to `/tmp/edpvz-archive-files`.

Docker installs FFmpeg. No browser or repository contains Ivideon access tokens.
The edge function authenticates the account and loads its saved Ivideon connection.

## Preparation and accuracy

Up to 50 named clips per request. There is no application limit on clip duration.
The server requests adjacent 15-minute intervals, retries refused intervals in
smaller parts down to one minute, and concatenates them with explicit durations.
HLS ingestion falls back to provider MP4 export. MP4 sources are downloaded once
before decoding, so remote seeking does not repeatedly fetch the signed relay.

Requested output: source resolution, up to 1080p, 720p or 480p, without upscaling.
Output is H.264/AAC MP4. Video packet continuity and duration are checked; detected
missing frames or short sources fail instead of silently removing a gap.
Precision follows source frame times, rather than promising impossible exactness
when a camera has missing footage. The original camera timestamp is not rewritten.

Native HLS preview falls back to prepared MP4 for incompatible browsers. Large
preview intervals use MP4 preparation directly. Multiple cameras can contribute
separate named clips to one saved account queue.

## Saving

Prepared MP4/JPEG files have rename, signed download, destination picker and cloud
save controls. Desktop browsers supporting `showSaveFilePicker` stream to the
chosen file. Mobile browsers use their normal download/share mechanisms; websites
cannot choose an arbitrary iOS filesystem path. Sharing requests a second click
after loading the file to preserve the browser's required user gesture. Large
mobile files use normal downloads instead of buffering them entirely in memory.

## Cloud app registration

Register applications owned by EdPVZ; do not use another service's client IDs.

Google:

- Configure an external web OAuth application, allowed users/consent and any
  provider-required publishing verification.
- Callback: `https://edpvz-telegram-collector.onrender.com/archive/cloud/google/callback`
- Scope: `https://www.googleapis.com/auth/drive.file`
- Server variables: `ARCHIVE_GOOGLE_CLIENT_ID`, `ARCHIVE_GOOGLE_CLIENT_SECRET`.

Yandex:

- Register a web OAuth application with Disk write/info permission.
- Callback: `https://edpvz-telegram-collector.onrender.com/archive/cloud/yandex/callback`
- Scopes: `cloud_api:disk.write cloud_api:disk.info`
- Server variables: `ARCHIVE_YANDEX_CLIENT_ID`, `ARCHIVE_YANDEX_CLIENT_SECRET`.

Only after configuring these values can owners connect their own disks. Until
then the interface explicitly reports that cloud OAuth is not configured.
Encrypted refresh/access tokens are saved under each owner's RLS scope in
`edpvz_user_data`. Google uses resumable-upload initialization; Yandex uses the
signed Disk upload endpoint and an `Эд ПВЗ` folder. Cloud uploads require live
verification after application registration; this repository does not assert
that they have been verified against unconfigured accounts.

## Operational limits

Current jobs and output files are temporary on one server instance. Metadata for
selected clips/job IDs is saved in the account, but a restart loses working files
and active jobs. Expired files are cleaned after 24 hours on subsequent requests.
Disk space, provider availability, CPU, connection speed and valid account auth
still bound feasible exports. Closed tabs do not refresh an expired account JWT.
A permanent multi-owner release should use a dedicated worker, durable job state
and private object storage before promising recoverable multi-hour unattended jobs.

Processing is serialized, with at most two active requests per owner and ten
queued/running requests globally. Source gaps cannot be reconstructed or hidden.

## Checks

From this directory:

```bash
python tests/test_archive_processing.py
python tests/test_archive_security.py
```

These tests exercise FFmpeg concatenation/duration validation, missing footage,
owner isolation, authenticated requests, signed links, exact downloaded bytes and
invalid JPEG input. Manual release checks must additionally cover real downloads,
archive preview and frame selection on Chrome and iOS Safari, different camera
profiles, both registered OAuth apps, long jobs and restart recovery behavior.
