# Reset Desktop QA Checklist

## 1) Reset Trading
1. Open app and create demo open positions.
2. Close at least one position so `Closed Positions > 0`.
3. Confirm Journal has trade entries.
4. Click `Reset Positions` (Reset Trading scope).
5. Confirm:
   - Open Positions = 0
   - Closed Positions = 0
   - No pending/active orders shown
6. Exit app completely.
7. Reopen app.
8. Confirm old open/closed positions did not return.

## 2) Reset ML
1. Ensure ML has records (closed trades + trained model state).
2. Click `Reset ML Brain`.
3. Restart app.
4. Confirm ML model/cache state is empty.
5. Confirm trading positions/settings are still preserved.

## 3) Full Demo Reset
1. Create demo open/closed positions and journal activity.
2. Click `Full Reset` (Full Demo Reset scope).
3. Exit app completely.
4. Reopen app.
5. Confirm demo trading data/journal data did not return.
6. Confirm settings + banned coins are preserved.

## 4) Log checks
Verify logs include:
- `RESET_REQUESTED`
- `RESET_SCOPE_RESOLVED`
- `RESET_STORAGE_MAP_AUDIT`
- `RESET_RUNTIME_CLEAR_START`
- `RESET_PERSISTENCE_CLEAR_START`
- `RESET_BACKUP_CLEAR_START`
- `RESET_VERIFY_START`
- `RESET_VERIFY_SUCCESS` (or `RESET_VERIFY_FAILED` with reason)
- `RESET_MARKER_WRITTEN`
- `RESET_MARKER_CONSUMED`
- `RESET_COMPLETE`
