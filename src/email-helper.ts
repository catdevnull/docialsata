import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

// Define a type for the IMAP server details we need, excluding user/password
type ImapServerConfig = {
  host: string;
  port: number;
  secure: boolean;
};

function getImapConfig(email: string): ImapServerConfig {
  const lowerEmail = email.toLowerCase();
  if (lowerEmail.endsWith('@gmail.com')) {
    return { host: 'imap.gmail.com', port: 993, secure: true };
  } else if (
    lowerEmail.endsWith('@outlook.com') ||
    lowerEmail.endsWith('@hotmail.com')
  ) {
    return {
      host: 'outlook.office365.com',
      port: 993,
      secure: true,
    };
  } else if (lowerEmail.endsWith('@rambler.ru')) {
    return { host: 'imap.rambler.ru', port: 993, secure: true };
  } else if (lowerEmail.endsWith('@gmx.com')) {
    return { host: 'imap.gmx.com', port: 993, secure: true };
  }
  const domain = email.includes('@') ? email.split('@')[1] : 'unknown';
  throw new Error(
    `Unsupported email provider for automatic code retrieval: ${domain}`,
  );
}

export async function fetchConfirmationCodeFromEmail(
  email: string,
  password: string,
): Promise<string> {
  const serverConfig = getImapConfig(email);
  const client = new ImapFlow({
    host: serverConfig.host,
    port: serverConfig.port,
    secure: serverConfig.secure,
    auth: {
      user: email,
      pass: password,
    },
    logger: false, // Disable default logging
  });

  try {
    console.log(
      `Connecting to IMAP server ${serverConfig.host} for user ${email}...`,
    );
    await client.connect();
    console.log('Successfully connected to IMAP server.');

    const mailbox = await client.mailboxOpen('INBOX');
    await client.mailbox;
    console.log('Opened INBOX.');
    const messages = (await client.fetchAll('*:1', { source: true })).sort(
      (a, b) => b.uid - a.uid,
    );

    for await (const fetch of messages) {
      try {
        const mail = await simpleParser(fetch.source);
        const emailText =
          mail.subject +
          (mail.text || (typeof mail.html === 'string' ? mail.html : '') || '');

        const codeMatch = emailText.match(
          /confirmation code is ([a-zA-Z0-9]{8})/,
        );
        if (codeMatch && codeMatch[1]) {
          console.log('Found code:', codeMatch[1]);
          return codeMatch[1];
        } else {
          console.log('No code found in this email body.');
        }
      } catch (parseError) {
        console.error(
          `Error parsing email body for UID ${fetch.uid}:`,
          parseError,
        );
      }
    }

    throw new Error('Could not find a confirmation code in recent emails.');
  } catch (err) {
    console.error('IMAP Error:', err);
    throw new Error(
      `IMAP connection failed for ${email}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  } finally {
    try {
      console.log('Closing IMAP connection.');
      client.close();
    } catch (endError) {
      console.error('Error closing IMAP connection:', endError);
    }
  }
}
