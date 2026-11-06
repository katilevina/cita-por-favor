# Cita Por Favor (English Documentation)

> 🇷🇺 **Русская версия**: [README.md](README.md)

A local browser assistant for checking appointment (`cita previa`) availability in **Barcelona province** for:
- **TIE Fingerprints (`Toma de Huellas`)** — initial card or renewal after *Resolución Favorable*
- **Card Issuance (`Expedición de Tarjetas / Gestión Migratoria`)**
- **TIE Pickup (`Recogida de Tarjeta / Lote`)**
- **NIE Assignment (`Asignación de NIE`)**

It runs 100% locally in Chrome via **Tampermonkey**, checks for available appointments on a customizable human-like schedule, and alerts you with sound/voice when slots open. Final confirmation (SMS OTP / captcha) is always completed by you.

> **🌐 Multi-Language UI (`EN` / `RU`)**: The panel includes a built-in language switcher (`🌐 Language / Язык`) at the top of the panel to toggle between **English (`EN`)** and **Russian (`RU`)** at any time.

---

## Quick Start (Windows, macOS & Linux)

### 1. Install Tampermonkey & Enable User Scripts
1. Install [Tampermonkey for Chrome](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo).
2. Open `chrome://extensions`, click **Details** on Tampermonkey, and turn **ON** **`Allow User Scripts`** *(required by Chrome)*.

### 2. Install the Script
1. Open [`cita-autofill.user.js`](cita-autofill.user.js) and click **Copy raw file**.
2. Click the Tampermonkey icon in Chrome → **Create a new script...**
3. Select all (`Ctrl+A` / `Cmd+A`), paste the script (`Ctrl+V` / `Cmd+V`), and save (`Ctrl+S` / `Cmd+S`).

### 3. Open the Appointment Page & Configure
1. Open the Barcelona Extranjería page:
   [https://icp.administracionelectronica.gob.es/icpplustieb/citar?p=8](https://icp.administracionelectronica.gob.es/icpplustieb/citar?p=8)
2. The dark **Cita Por Favor** panel will appear in the top-right corner.
3. Click **`⚙️ Settings`**:
   - **`👤 Edit My Personal Details`**: Enter your NIE/Passport, Full Name, Birth Year, Nationality, Phone, and Email → click **Save Personal Details**. *(Stored only locally inside Tampermonkey on your computer).*
   - **`🔍 Edit Search Settings`**: Select your procedure (e.g. *Fingerprints / Toma de Huellas*) and login method (e.g. **Via Cl@ve** → **With Digital Certificate in Chrome (eIdentifier)**) → click **Save Search Settings**.
   - **`📍 Offices to Check`**: Leave unchecked to search all of Barcelona province, or select specific police stations.
4. Click **`Check Now`** to test a single run, or **`Start Checking`** to run on the configured schedule.

---

## Privacy & Safety

- **100% Local**: Your personal details (`NIE`, name, phone, email) never leave your browser except to fill the official Spanish government form (`*.administracionelectronica.gob.es`).
- **One Tab Only**: Run checks in a single tab on one computer at a time to avoid rate-limiting or IP blocks.
- Detailed documentation (in Russian): [SETUP.md](SETUP.md) · [PRIVACY.md](PRIVACY.md) · [SAFE_USE.md](SAFE_USE.md) · [CHANGELOG.md](CHANGELOG.md)

## License

Available for personal and non-commercial use under [PolyForm Noncommercial 1.0.0](LICENSE.md). Copyright — Katya Levina.
