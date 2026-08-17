const { Resend } = require('resend');

// ── helpers ───────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Časy v mailech se MUSÍ renderovat v české zóně, ne v zóně serveru:
// Railway kontejner běží v UTC, takže bez tohohle by mail u rezervace
// na 8:00 ukázal 6:00 (v zimě 7:00). Klient si data zobrazuje sám v zóně
// prohlížeče, tady je server jediný, kdo formátuje.
const TZ = 'Europe/Prague';

const DATE_FMT = {
  timeZone: TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

function formatDate(date) {
  return new Date(date).toLocaleString('cs-CZ', DATE_FMT);
}

// ── Resend client singleton ───────────────────────────────────────────────────

let _client = null;

function getClient() {
  if (!process.env.RESEND_API_KEY) return null;
  if (!_client) _client = new Resend(process.env.RESEND_API_KEY);
  return _client;
}

// ── layout helpers ────────────────────────────────────────────────────────────

function baseLayout({ headerColor = '#1a3a5c', headerText = 'ForTool Technologies', body }) {
  return `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f0f2f5;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
         style="background-color:#f0f2f5;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" role="presentation"
               style="max-width:600px;width:100%;background-color:#ffffff;
                      border-radius:10px;overflow:hidden;
                      box-shadow:0 4px 16px rgba(0,0,0,0.10);">

          <!-- Header -->
          <tr>
            <td style="background-color:${headerColor};padding:28px 40px;text-align:center;">
              <p style="margin:0;color:#ffffff;font-size:11px;letter-spacing:2px;
                        text-transform:uppercase;opacity:0.7;">Rezervační systém</p>
              <h1 style="margin:6px 0 0;color:#ffffff;font-size:22px;font-weight:bold;
                         letter-spacing:0.5px;">${headerText}</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              ${body}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f8f9fb;padding:20px 40px;text-align:center;
                       border-top:1px solid #e8eaed;">
              <p style="margin:0;color:#9aa0a6;font-size:12px;">
                ForTool Technologies &copy; ${new Date().getFullYear()}<br>
                Tento email byl vygenerován automaticky. Neodpovídejte na něj.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function codeBlock(code) {
  return `<div style="margin:32px 0;text-align:center;">
    <div style="display:inline-block;background-color:#f0f4ff;border:2px dashed #1a3a5c;
                border-radius:12px;padding:20px 40px;">
      <span style="font-size:40px;font-weight:bold;letter-spacing:10px;
                   color:#1a3a5c;font-family:Courier New,monospace;">${code}</span>
    </div>
    <p style="margin:12px 0 0;color:#9aa0a6;font-size:13px;">Kód je platný po dobu <strong>1 hodiny</strong>.</p>
  </div>`;
}

function linkButton(href, label, color = '#1D6FE0') {
  return `<div style="margin:28px 0;text-align:center;">
    <a href="${href}" style="display:inline-block;background-color:${color};color:#ffffff;
       font-size:15px;font-weight:bold;text-decoration:none;padding:14px 32px;
       border-radius:8px;letter-spacing:0.3px;">${label}</a>
  </div>`;
}

// ── send helper ───────────────────────────────────────────────────────────────

async function send({ to, subject, html }) {
  const client = getClient();
  if (!client) {
    console.warn('[Email] RESEND_API_KEY není nastaven – email nebyl odeslán.');
    return;
  }
  await client.emails.send({ from: process.env.EMAIL_FROM, to, subject, html });
}

// ── email functions ───────────────────────────────────────────────────────────

async function sendVerificationEmail(to, firstName, code) {
  const html = baseLayout({
    body: `
      <p style="margin:0 0 8px;color:#5f6368;font-size:15px;">Dobrý den, <strong>${esc(firstName)}</strong>,</p>
      <p style="margin:0 0 24px;color:#5f6368;font-size:15px;">
        Pro dokončení registrace potvrďte svůj email zadáním tohoto kódu:
      </p>
      ${codeBlock(esc(code))}
      <p style="margin:24px 0 0;color:#9aa0a6;font-size:13px;">
        Pokud jste si nevytvořili účet ve ForTool Technologies, tento email ignorujte.
      </p>
    `,
  });
  await send({ to, subject: 'Ověření účtu – ForTool Technologies', html });
}

async function sendPasswordResetEmail(to, firstName, code) {
  const html = baseLayout({
    body: `
      <p style="margin:0 0 8px;color:#5f6368;font-size:15px;">Dobrý den, <strong>${esc(firstName)}</strong>,</p>
      <p style="margin:0 0 24px;color:#5f6368;font-size:15px;">
        Obdrželi jsme žádost o reset hesla k vašemu účtu. Použijte tento kód:
      </p>
      ${codeBlock(esc(code))}
      <p style="margin:24px 0 0;color:#9aa0a6;font-size:13px;">
        Pokud jste o reset hesla nežádali, tento email ignorujte. Váš účet zůstane nezměněn.
      </p>
    `,
  });
  await send({ to, subject: 'Reset hesla – ForTool Technologies', html });
}

async function sendBookingConfirmation(to, firstName, booking) {
  const html = baseLayout({
    body: `
      <p style="margin:0 0 8px;color:#5f6368;font-size:15px;">Dobrý den, <strong>${esc(firstName)}</strong>,</p>
      <p style="margin:0 0 28px;color:#5f6368;font-size:15px;">
        Vaše rezervace firemního vozidla byla <strong style="color:#1a7c3e;">úspěšně vytvořena</strong>.
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
             style="background-color:#f8f9fb;border-radius:8px;border-left:4px solid #1a3a5c;
                    padding:20px 24px;margin-bottom:28px;">
        <tr>
          <td>
            <p style="margin:0 0 10px;color:#9aa0a6;font-size:11px;
                      text-transform:uppercase;letter-spacing:1px;">Detail rezervace</p>
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
              <tr>
                <td style="padding:6px 0;color:#5f6368;font-size:14px;width:120px;">Od:</td>
                <td style="padding:6px 0;color:#1a1a1a;font-size:14px;font-weight:bold;">
                  ${formatDate(booking.dateFrom)}
                </td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#5f6368;font-size:14px;">Do:</td>
                <td style="padding:6px 0;color:#1a1a1a;font-size:14px;font-weight:bold;">
                  ${formatDate(booking.dateTo)}
                </td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#5f6368;font-size:14px;vertical-align:top;">Účel:</td>
                <td style="padding:6px 0;color:#1a1a1a;font-size:14px;">${esc(booking.purpose)}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <p style="margin:0;color:#9aa0a6;font-size:13px;">
        Rezervaci můžete zrušit nebo upravit ve svém účtu na portálu ForTool.
      </p>
    `,
  });
  await send({ to, subject: 'Potvrzení rezervace – ForTool Technologies', html });
}

async function sendBookingCancellation(to, firstName, booking) {
  const html = baseLayout({
    headerColor: '#8b1a1a',
    body: `
      <p style="margin:0 0 8px;color:#5f6368;font-size:15px;">Dobrý den, <strong>${esc(firstName)}</strong>,</p>
      <p style="margin:0 0 28px;color:#5f6368;font-size:15px;">
        Vaše rezervace firemního vozidla byla <strong style="color:#8b1a1a;">zrušena</strong>.
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
             style="background-color:#fff5f5;border-radius:8px;border-left:4px solid #8b1a1a;
                    padding:20px 24px;margin-bottom:28px;">
        <tr>
          <td>
            <p style="margin:0 0 10px;color:#9aa0a6;font-size:11px;
                      text-transform:uppercase;letter-spacing:1px;">Zrušená rezervace</p>
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
              <tr>
                <td style="padding:6px 0;color:#5f6368;font-size:14px;width:120px;">Od:</td>
                <td style="padding:6px 0;color:#1a1a1a;font-size:14px;font-weight:bold;">
                  ${formatDate(booking.dateFrom)}
                </td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#5f6368;font-size:14px;">Do:</td>
                <td style="padding:6px 0;color:#1a1a1a;font-size:14px;font-weight:bold;">
                  ${formatDate(booking.dateTo)}
                </td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#5f6368;font-size:14px;vertical-align:top;">Účel:</td>
                <td style="padding:6px 0;color:#1a1a1a;font-size:14px;">${esc(booking.purpose)}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <p style="margin:0;color:#9aa0a6;font-size:13px;">
        Pokud si myslíte, že jde o chybu, kontaktujte administrátora systému.
      </p>
    `,
  });
  await send({ to, subject: 'Zrušení rezervace – ForTool Technologies', html });
}

// Hromadné storno správcem: JEDEN mail vlastníkovi se seznamem všech jeho
// zrušených rezervací (ne N mailů) — styl dle sendBookingCancellation
async function sendBookingsBulkCancelled(to, firstName, vehicle, bookings) {
  const rows = bookings.map(b => `
    <tr>
      <td style="padding:6px 12px 6px 0;color:#1a1a1a;font-size:14px;font-weight:bold;white-space:nowrap;vertical-align:top;">
        ${formatDate(b.dateFrom)} &ndash; ${formatDate(b.dateTo)}
      </td>
      <td style="padding:6px 0;color:#5f6368;font-size:14px;">${esc(b.purpose)}</td>
    </tr>`).join('');

  const html = baseLayout({
    headerColor: '#8b1a1a',
    body: `
      <p style="margin:0 0 8px;color:#5f6368;font-size:15px;">Dobrý den, <strong>${esc(firstName)}</strong>,</p>
      <p style="margin:0 0 28px;color:#5f6368;font-size:15px;">
        Správce <strong style="color:#8b1a1a;">zrušil</strong> ${bookings.length === 1
          ? 'vaši rezervaci'
          : `vaše rezervace (${bookings.length})`} vozidla
        <strong>${esc(vehicle.name)}</strong>${vehicle.plate ? ` (${esc(vehicle.plate)})` : ''}.
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
             style="background-color:#fff5f5;border-radius:8px;border-left:4px solid #8b1a1a;
                    padding:20px 24px;margin-bottom:28px;">
        <tr>
          <td>
            <p style="margin:0 0 10px;color:#9aa0a6;font-size:11px;
                      text-transform:uppercase;letter-spacing:1px;">Zrušené rezervace</p>
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
              ${rows}
            </table>
          </td>
        </tr>
      </table>

      <p style="margin:0;color:#9aa0a6;font-size:13px;">
        Pokud si myslíte, že jde o chybu, kontaktujte administrátora systému.
      </p>
    `,
  });
  await send({ to, subject: 'Zrušení rezervací – ForTool Technologies', html });
}

async function sendUserBookingUpdatedByAdmin(to, firstName, { original, updated, vehicle }) {
  const html = baseLayout({
    body: `
      <p style="margin:0 0 8px;color:#5f6368;font-size:15px;">Dobrý den, <strong>${esc(firstName)}</strong>,</p>
      <p style="margin:0 0 28px;color:#5f6368;font-size:15px;">
        Vaše rezervace firemního vozidla byla <strong style="color:#1D6FE0;">upravena správcem</strong>.
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
             style="background-color:#f8f9fb;border-radius:8px;border-left:4px solid #1D6FE0;
                    padding:20px 24px;margin-bottom:28px;">
        <tr>
          <td>
            <p style="margin:0 0 10px;color:#9aa0a6;font-size:11px;
                      text-transform:uppercase;letter-spacing:1px;">Upravená rezervace</p>
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
              ${vehicle ? `<tr>
                <td style="padding:6px 0;color:#5f6368;font-size:14px;width:130px;">Vozidlo:</td>
                <td style="padding:6px 0;color:#1a1a1a;font-size:14px;">${esc(vehicle.name)} (${esc(vehicle.plate)})</td>
              </tr>` : ''}
              <tr>
                <td style="padding:6px 0;color:#5f6368;font-size:14px;width:130px;">Původní termín:</td>
                <td style="padding:6px 0;color:#9aa0a6;font-size:14px;">
                  ${formatDate(original.dateFrom)} &ndash; ${formatDate(original.dateTo)}
                </td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#5f6368;font-size:14px;">Nový termín:</td>
                <td style="padding:6px 0;color:#1a1a1a;font-size:14px;font-weight:bold;">
                  ${formatDate(updated.dateFrom)} &ndash; ${formatDate(updated.dateTo)}
                </td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#5f6368;font-size:14px;vertical-align:top;">Účel:</td>
                <td style="padding:6px 0;color:#1a1a1a;font-size:14px;">${esc(updated.purpose)}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <p style="margin:0;color:#9aa0a6;font-size:13px;">
        Pokud máte k úpravě dotaz, kontaktujte administrátora systému.
      </p>
    `,
  });
  await send({ to, subject: 'Vaše rezervace byla upravena – ForTool Technologies', html });
}

async function sendAdminNewRegistration(adminEmails, applicant) {
  const adminUrl = `${process.env.CLIENT_URL || ''}/admin/registrace`;
  const registeredAt = formatDate(applicant.createdAt);

  const html = baseLayout({
    body: `
      <p style="margin:0 0 8px;color:#5f6368;font-size:15px;">Nová žádost o registraci čeká na schválení.</p>
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
             style="background-color:#f8f9fb;border-radius:8px;border-left:4px solid #1D6FE0;
                    padding:20px 24px;margin:24px 0;">
        <tr><td>
          <p style="margin:0 0 10px;color:#9aa0a6;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Žadatel</p>
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
            <tr>
              <td style="padding:5px 0;color:#5f6368;font-size:14px;width:110px;">Jméno:</td>
              <td style="padding:5px 0;color:#1a1a1a;font-size:14px;font-weight:bold;">
                ${esc(applicant.firstName)} ${esc(applicant.lastName)}
              </td>
            </tr>
            <tr>
              <td style="padding:5px 0;color:#5f6368;font-size:14px;">E-mail:</td>
              <td style="padding:5px 0;color:#1a1a1a;font-size:14px;">${esc(applicant.email)}</td>
            </tr>
            <tr>
              <td style="padding:5px 0;color:#5f6368;font-size:14px;">Čas registrace:</td>
              <td style="padding:5px 0;color:#1a1a1a;font-size:14px;">${registeredAt}</td>
            </tr>
          </table>
        </td></tr>
      </table>
      ${linkButton(adminUrl, 'Přejít na správu registrací')}
      <p style="margin:0;color:#9aa0a6;font-size:13px;">
        Registraci schválíte nebo zamítnete po přihlášení do aplikace.
      </p>
    `,
  });

  await send({
    to: adminEmails,
    subject: `Nová registrace ke schválení – ${esc(applicant.firstName)} ${esc(applicant.lastName)}`,
    html,
  });
}

async function sendRegistrationReceived(to, firstName) {
  const html = baseLayout({
    body: `
      <p style="margin:0 0 8px;color:#5f6368;font-size:15px;">Dobrý den, <strong>${esc(firstName)}</strong>,</p>
      <p style="margin:0 0 24px;color:#5f6368;font-size:15px;">
        Vaše žádost o účet byla zaevidována a nyní <strong>čeká na schválení správcem</strong>.
        Jakmile ji schválí, dáme vám vědět e-mailem a budete se moci přihlásit.
      </p>
      <p style="margin:0;color:#9aa0a6;font-size:13px;">
        Pokud jste si registraci nevytvořili, tento email ignorujte.
      </p>
    `,
  });
  await send({ to, subject: 'Žádost o registraci zaevidována – ForTool Technologies', html });
}

async function sendAccountApproved(to, firstName) {
  const loginUrl = process.env.CLIENT_URL || '';

  const html = baseLayout({
    headerColor: '#1B8A5A',
    body: `
      <p style="margin:0 0 8px;color:#5f6368;font-size:15px;">Dobrý den, <strong>${esc(firstName)}</strong>,</p>
      <p style="margin:0 0 24px;color:#5f6368;font-size:15px;">
        Váš účet byl <strong style="color:#1B8A5A;">schválen administrátorem</strong>.
        Nyní se můžete přihlásit a začít rezervovat firemní vozidlo.
      </p>
      ${linkButton(loginUrl, 'Přihlásit se do aplikace', '#1B8A5A')}
      <p style="margin:0;color:#9aa0a6;font-size:13px;">
        Pokud jste si registraci nevytvořili, kontaktujte správce systému.
      </p>
    `,
  });
  await send({ to, subject: 'Účet schválen – ForTool Technologies', html });
}

async function sendAccountRejected(to, firstName) {
  const html = baseLayout({
    headerColor: '#8b1a1a',
    body: `
      <p style="margin:0 0 8px;color:#5f6368;font-size:15px;">Dobrý den, <strong>${esc(firstName)}</strong>,</p>
      <p style="margin:0 0 24px;color:#5f6368;font-size:15px;">
        Vaše žádost o registraci byla <strong style="color:#8b1a1a;">zamítnuta administrátorem</strong>.
      </p>
      <p style="margin:0;color:#9aa0a6;font-size:13px;">
        Pokud si myslíte, že jde o chybu, kontaktujte správce systému.
      </p>
    `,
  });
  await send({ to, subject: 'Registrace zamítnuta – ForTool Technologies', html });
}

async function sendPasswordChanged(to, firstName) {
  const changedAt = formatDate(new Date());

  const html = baseLayout({
    body: `
      <p style="margin:0 0 8px;color:#5f6368;font-size:15px;">Dobrý den, <strong>${esc(firstName)}</strong>,</p>
      <p style="margin:0 0 24px;color:#5f6368;font-size:15px;">
        Heslo k vašemu účtu ForTool Technologies bylo právě <strong>změněno</strong>.
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
             style="background-color:#f8f9fb;border-radius:8px;border-left:4px solid #1a3a5c;
                    padding:20px 24px;margin-bottom:24px;">
        <tr>
          <td style="padding:5px 0;color:#5f6368;font-size:14px;width:120px;">Čas změny:</td>
          <td style="padding:5px 0;color:#1a1a1a;font-size:14px;font-weight:bold;">${changedAt}</td>
        </tr>
      </table>
      <p style="margin:0;color:#9aa0a6;font-size:13px;">
        Pokud jste tuto změnu neprovedli vy, kontaktujte prosím administrátora systému.
      </p>
    `,
  });
  await send({ to, subject: 'Heslo bylo změněno – ForTool Technologies', html });
}

async function sendAdminBookingCreated(adminEmails, booking, user) {
  const appUrl = process.env.CLIENT_URL || '';

  const html = baseLayout({
    body: `
      <p style="margin:0 0 8px;color:#5f6368;font-size:15px;">Byla vytvořena nová rezervace firemního vozidla.</p>
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
             style="background-color:#f8f9fb;border-radius:8px;border-left:4px solid #1a3a5c;
                    padding:20px 24px;margin:24px 0;">
        <tr><td>
          <p style="margin:0 0 10px;color:#9aa0a6;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Detail rezervace</p>
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
            <tr>
              <td style="padding:5px 0;color:#5f6368;font-size:14px;width:110px;">Uživatel:</td>
              <td style="padding:5px 0;color:#1a1a1a;font-size:14px;font-weight:bold;">
                ${esc(user.firstName)} ${esc(user.lastName)}
              </td>
            </tr>
            <tr>
              <td style="padding:5px 0;color:#5f6368;font-size:14px;">Od:</td>
              <td style="padding:5px 0;color:#1a1a1a;font-size:14px;">${formatDate(booking.dateFrom)}</td>
            </tr>
            <tr>
              <td style="padding:5px 0;color:#5f6368;font-size:14px;">Do:</td>
              <td style="padding:5px 0;color:#1a1a1a;font-size:14px;">${formatDate(booking.dateTo)}</td>
            </tr>
            <tr>
              <td style="padding:5px 0;color:#5f6368;font-size:14px;vertical-align:top;">Účel:</td>
              <td style="padding:5px 0;color:#1a1a1a;font-size:14px;">${esc(booking.purpose)}</td>
            </tr>
          </table>
        </td></tr>
      </table>
      ${linkButton(appUrl, 'Přejít do aplikace')}
    `,
  });

  await send({
    to: adminEmails,
    subject: 'Nová rezervace vozidla – ForTool Technologies',
    html,
  });
}

async function sendAdminBookingUpdated(adminEmails, { original, updated, user, vehicle }) {
  const html = baseLayout({
    body: `
      <p style="margin:0 0 8px;color:#5f6368;font-size:15px;">Rezervace firemního vozidla byla <strong style="color:#1D6FE0;">upravena</strong>.</p>
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
             style="background-color:#f8f9fb;border-radius:8px;border-left:4px solid #1D6FE0;
                    padding:20px 24px;margin:24px 0;">
        <tr><td>
          <p style="margin:0 0 10px;color:#9aa0a6;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Upravená rezervace</p>
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
            <tr>
              <td style="padding:5px 0;color:#5f6368;font-size:14px;width:130px;">Uživatel:</td>
              <td style="padding:5px 0;color:#1a1a1a;font-size:14px;font-weight:bold;">
                ${esc(user.firstName)} ${esc(user.lastName)}
              </td>
            </tr>
            ${vehicle ? `<tr>
              <td style="padding:5px 0;color:#5f6368;font-size:14px;">Vozidlo:</td>
              <td style="padding:5px 0;color:#1a1a1a;font-size:14px;">${esc(vehicle.name)} (${esc(vehicle.plate)})</td>
            </tr>` : ''}
            <tr>
              <td style="padding:5px 0;color:#5f6368;font-size:14px;">Původní termín:</td>
              <td style="padding:5px 0;color:#9aa0a6;font-size:14px;">
                ${formatDate(original.dateFrom)} &ndash; ${formatDate(original.dateTo)}
              </td>
            </tr>
            <tr>
              <td style="padding:5px 0;color:#5f6368;font-size:14px;">Nový termín:</td>
              <td style="padding:5px 0;color:#1a1a1a;font-size:14px;font-weight:bold;">
                ${formatDate(updated.dateFrom)} &ndash; ${formatDate(updated.dateTo)}
              </td>
            </tr>
            <tr>
              <td style="padding:5px 0;color:#5f6368;font-size:14px;vertical-align:top;">Účel:</td>
              <td style="padding:5px 0;color:#1a1a1a;font-size:14px;">${esc(updated.purpose)}</td>
            </tr>
          </table>
        </td></tr>
      </table>
    `,
  });

  await send({
    to: adminEmails,
    subject: 'Úprava rezervace vozidla – ForTool Technologies',
    html,
  });
}

async function sendAdminBookingCancelled(adminEmails, booking, user) {
  const html = baseLayout({
    headerColor: '#8b1a1a',
    body: `
      <p style="margin:0 0 8px;color:#5f6368;font-size:15px;">Rezervace firemního vozidla byla <strong style="color:#8b1a1a;">zrušena</strong>.</p>
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
             style="background-color:#fff5f5;border-radius:8px;border-left:4px solid #8b1a1a;
                    padding:20px 24px;margin:24px 0;">
        <tr><td>
          <p style="margin:0 0 10px;color:#9aa0a6;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Zrušená rezervace</p>
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
            <tr>
              <td style="padding:5px 0;color:#5f6368;font-size:14px;width:110px;">Uživatel:</td>
              <td style="padding:5px 0;color:#1a1a1a;font-size:14px;font-weight:bold;">
                ${esc(user.firstName)} ${esc(user.lastName)}
              </td>
            </tr>
            <tr>
              <td style="padding:5px 0;color:#5f6368;font-size:14px;">Od:</td>
              <td style="padding:5px 0;color:#1a1a1a;font-size:14px;">${formatDate(booking.dateFrom)}</td>
            </tr>
            <tr>
              <td style="padding:5px 0;color:#5f6368;font-size:14px;">Do:</td>
              <td style="padding:5px 0;color:#1a1a1a;font-size:14px;">${formatDate(booking.dateTo)}</td>
            </tr>
            <tr>
              <td style="padding:5px 0;color:#5f6368;font-size:14px;vertical-align:top;">Účel:</td>
              <td style="padding:5px 0;color:#1a1a1a;font-size:14px;">${esc(booking.purpose)}</td>
            </tr>
          </table>
        </td></tr>
      </table>
    `,
  });

  await send({
    to: adminEmails,
    subject: 'Zrušení rezervace vozidla – ForTool Technologies',
    html,
  });
}

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendBookingConfirmation,
  sendBookingCancellation,
  sendBookingsBulkCancelled,
  sendUserBookingUpdatedByAdmin,
  sendAdminNewRegistration,
  sendRegistrationReceived,
  sendAccountApproved,
  sendAccountRejected,
  sendPasswordChanged,
  sendAdminBookingCreated,
  sendAdminBookingUpdated,
  sendAdminBookingCancelled,
};
