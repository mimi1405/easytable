```markdown
# TODOs

- [x] Add email / pw-reset functionality library for email
	- Use https://resend.com/ lib
	- include api side (localMaster and relaySyncApi)
	- Add in pfadmin functionality for pw and pin reset for employees
	- Add in staff pwa owner module a "Mitarbeiter" view, where crud is possible for employees and include there also reset pw for employees


- [ ] Add payment functionality
	- Soon wallee pax terminal will arrive
    as soon as we have it we can start mocking
    payments with a terminal (not yet arrived)
    - We should analyze the wallee docs with wallee skill we made for terminal integration and discuss how we channel subtenants in the future for walle we will be a platform so we have subtenants
    - We need to think trough how we bring the "whole" system flowing
    - Future option: if wallee Local Network API is enabled on a terminal, relaySyncApi could send a relay command to the tenant's localMaster and localMaster could trigger the local terminal payment directly on the LAN. Keep Cloud API as V1, but evaluate this as the local-first/offline-friendly payment path.


- [ ] check if bidirectional syncs really happen
    - meant is: assuming we have a owner of a restaurant, he is home, he wants to edit catalog for example a product, does that data manipulation flow trough relaySyncApi and then sends a command to localMaster of that tenant to update itself?
    - Do we sync db of tenants on both sides? A tenant has localMaster with local SQLiteDB and his data should be aswell in postgres in cloud with relaySyncAPI, so it acts like a backup or security copy of the data
    - This is fundamental for the bigger picture and we need to answer these questions with yes, no partial yes

- [ ] Complete deployment, discovery and lifecycle architecture
    - [x] Return Better Auth tenant/location context and remove Staff build-time tenant/location selection
    - [x] Validate LocalMaster tenant/location/instance before choosing local mode
    - [x] Serve the same Staff build from LocalMaster under `/staff`
    - [x] Add paired-device plus PIN offline Staff sessions
    - [x] Add API compatibility and update-safety contracts
    - [x] Add signed release-manifest and Tauri updater foundations
    - [ ] Produce and sign the Windows Master Station installer with bundled runtime and WinSW
    - [ ] Configure production update URLs/public keys and exercise rollback in a release environment
    - [ ] Replace remaining technician fields with the guided owner setup wizard


- [ ] Define and implement the deployment, discovery and lifecycle architecture
    - Remove tenant and location selection from build-time `.env` configuration. After Better Auth login, RelaySyncApi must return the user's tenant memberships, locations, roles and connection state.
    - Automatically select the context only when the user has exactly one valid tenant and location. Otherwise Staff must show an explicit tenant/location selector and validate the saved selection on every session start.
    - Use the same Staff codebase with two controlled entry points: a local Staff PWA served by LocalMaster for direct LAN operation, and the hosted Staff PWA for RelaySyncApi access outside the restaurant network.
    - Avoid cloud-HTTPS-to-local-HTTP discovery. Local Staff must verify the LocalMaster identity and bound tenant/location; remote Staff must use RelaySyncApi and idempotent relay commands.
    - Define local authentication for internet outages. Better Auth remains the cloud identity, while LocalMaster receives authorized location users during bootstrap and supports local PIN/device-token access with a defined offline validity policy.
    - Extend `/api/auth/me` or add an auth-context endpoint that returns tenant and location context instead of relying on `VITE_RELAY_TENANT_ID` / `VITE_RELAY_LOCATION_ID`.
    - Build a normal initial setup flow: Platform Admin creates tenant/location/owner, Owner completes account setup in Staff, installs Master Station, claims the location with a short-lived code or QR, and then pairs additional POS/KDS devices locally.
    - Keep URLs, instance ids and relay addresses out of the normal operator flow. Expose them only in a technician/recovery view.
    - Package LocalMaster as an automatically starting Windows service with its SQLite data under ProgramData, health diagnostics, firewall setup, backup-before-migration and recovery tooling.
    - Add signed update channels for LocalMaster and POS-Shell. POS-Shell should use the Tauri updater; LocalMaster needs a service-safe updater with health verification and rollback.
    - Add an API compatibility contract between LocalMaster and POS/Staff/KDS so clients cannot install an incompatible version. Do not update during open payments or other critical operations.
    - Preserve LocalMaster as the operational source of truth. Remote writes are successful only after the bound LocalMaster accepts the idempotent command; cloud order/payment data remains a sync/reporting read model.


- [x] Analytics owner module in staff
    - When hovering over the diagrams they show for example "700" instead of 7.00CHF because it uses raw Rappen number instead

- [x] Variant for products adding / editing is completely missing
    - add in owner staff module for catalog and products ability to give variantgroups with items to products / categories
    - products take from parent category if assigned, if set on product only product has it
