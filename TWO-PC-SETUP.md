# Using Maestro Billing on Two PCs

Both PCs share **one** database, kept on whichever PC you pick as the Main PC.
The second PC has no database of its own — it shows the same billing screen
over the studio Wi-Fi.

> **Do not** put `studio.db` in a shared folder and point both installs at it.
> SQLite (which this app uses) cannot safely have one database file opened by
> two PCs across a network share, and doing it will eventually corrupt the
> bills. The setup below is the safe way.

---

## Before you start

- Both PCs on the **same** Wi-Fi or network cable.
- Maestro Billing **2.1.0 or newer** installed on both.
- Decide which PC is the **Main PC**. Pick the one that:
  - is switched on the most, and
  - has the WhatsApp account linked.

---

## Step 1 — On the Main PC

1. Open Maestro Billing.
2. Press **Alt** to show the menu bar → **Setup** → **Connection Setup…**
   (or press **Ctrl+Shift+C**).
3. Choose **This is the Main PC**.
4. Tick **"Let another PC on this Wi-Fi connect to this one"**.
5. The screen now shows the address to use, for example:

   ```
   192.168.1.50:3179
   ```

   **Write this down.** You need it in Step 3.
6. Click **Save & Start**.

## Step 2 — Allow it through the Windows Firewall (Main PC, once)

Windows blocks the connection until you allow it. On the **Main PC**, right-click
the Start button → **Windows PowerShell (Admin)** / **Terminal (Admin)**, then
paste this and press Enter:

```powershell
New-NetFirewallRule -DisplayName "Maestro Billing" -Direction Inbound `
  -Protocol TCP -LocalPort 3179 -Action Allow `
  -Profile Private -RemoteAddress LocalSubnet
```

`-Profile Private -RemoteAddress LocalSubnet` keeps this limited to your own
studio network — it does not open the PC to the internet.

## Step 3 — On the second PC

1. Open Maestro Billing.
2. On first launch it asks how the PC should run. (If it doesn't, press **Alt** →
   **Setup** → **Connection Setup…**, or **Ctrl+Shift+C**.)
3. Choose **Connect to the Main PC**.
4. Type the address from Step 1, e.g. `192.168.1.50:3179`.
5. Click **Save & Start**.

The billing screen opens showing the same customers, products and bills as the
Main PC. Both people can create bills at the same time — bill numbers stay
unique and in sequence automatically.

---

## What runs where

| | Main PC | Second PC |
|---|---|---|
| Database | ✅ here | uses the Main PC's |
| Daily backups | ✅ here | — |
| WhatsApp sending | ✅ here | works, sends via the Main PC |
| Printing bills | ✅ its own printer | ✅ its own printer |
| Settings, reports | ✅ | ✅ (same data) |

---

## Things to know

**The Main PC must be on.** If it's off, asleep, or off the Wi-Fi, the second PC
cannot bill at all. There is no offline mode.

**The printer badge on the second PC is not reliable.** The "Printer ready"
indicator reports the *Main PC's* printer, because that check runs on the Main
PC. Printing itself works correctly from the second PC and uses that PC's own
printer — only the little status badge can be wrong. Ignore it on the second PC.

**Anyone on the same Wi-Fi can open the billing system.** There is no password.
This is fine on a private studio network that guests don't have the password to.
Do not enable sharing on public or customer-facing Wi-Fi.

**Back up from the Main PC only.** Settings → Database on either PC shows the
Main PC's backups, because there is only one database. Restoring a backup
(**Alt** → **Setup** → **Restore from Backup…**) also has to be done on the
Main PC — the second PC will tell you so rather than doing something wrong.

---

## If the second PC says "Cannot Reach the Main PC"

The app will offer **Retry**, **Change Connection Settings…**, or **Quit**.
Work through these in order:

1. Is the Main PC switched on with Maestro Billing **open**? It must be running,
   not just powered on.
2. Are both PCs on the **same** Wi-Fi? (Not one on Wi-Fi and one on a guest
   network or a phone hotspot.)
3. On the Main PC, is sharing still ticked? Alt → **Setup** →
   **Connection Setup…**
4. Did the Firewall rule in Step 2 get added?
5. **Has the address changed?** This is the most common cause. Routers hand out
   addresses that can change after a restart. Check the current address on the
   Main PC (Step 1), then use **Change Connection Settings…** on the second PC
   to enter the new one.

To stop the address changing, ask whoever set up your router to give the Main PC
a **fixed / reserved IP address**. Then it never moves.

---

## Going back to one PC

On either PC: **Alt** → **Setup** → **Connection Setup…** → **This is the Main PC**
→ untick sharing → **Save & Start**. The app restarts on its own database.

Note that a PC that has only ever run as the second PC has **no bills of its
own** — all the data lives on the Main PC. Switching it to "Main PC" gives it a
fresh, empty database, not a copy.
