const path = require('path');
const fs = require('fs');

// One-time migration from the pre-rebrand userData folder so upgrading
// users keep their electron-store settings and any other on-disk state.
// app.setName('SoundSync') points userData at %AppData%/SoundSync; the
// legacy build wrote to %AppData%/soundcloud-auto-sync (Electron derives
// the default from the package.json "name" when productName is unset on
// the app object, which is what the old build relied on).
//
// Safe to call repeatedly: if newUserData already exists, the copy is
// skipped. The cpSync call uses errorOnExist:false + force:false so any
// per-file conflict during a partial prior migration is a no-op.
function migrateUserDataFromLegacy(app) {
  try {
    const newUserData = app.getPath('userData');
    const legacyUserData = path.join(path.dirname(newUserData), 'soundcloud-auto-sync');
    if (!fs.existsSync(newUserData) && fs.existsSync(legacyUserData)) {
      fs.mkdirSync(newUserData, { recursive: true });
      for (const entry of fs.readdirSync(legacyUserData)) {
        fs.cpSync(
          path.join(legacyUserData, entry),
          path.join(newUserData, entry),
          { recursive: true, force: false, errorOnExist: false }
        );
      }
    }
  } catch (e) {
    console.error('userData migration failed:', e);
  }
}

module.exports = { migrateUserDataFromLegacy };
