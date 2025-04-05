import imaps, { type ImapSimpleOptions } from 'imap-simple';
import { simpleParser } from 'mailparser';

// Define a type for the IMAP server details we need, excluding user/password
type ImapServerConfig = Omit<ImapSimpleOptions['imap'], 'user' | 'password'>;

function getImapConfig(email: string): ImapServerConfig {
  const lowerEmail = email.toLowerCase();
  if (lowerEmail.endsWith('@gmail.com')) {
    return { host: 'imap.gmail.com', port: 993, tls: true, authTimeout: 3000 };
  } else if (
    lowerEmail.endsWith('@outlook.com') ||
    lowerEmail.endsWith('@hotmail.com')
  ) {
    return {
      host: 'outlook.office365.com',
      port: 993,
      tls: true,
      authTimeout: 3000,
    };
  } else if (lowerEmail.endsWith('@rambler.ru')) {
    return { host: 'imap.rambler.ru', port: 993, tls: true, authTimeout: 3000 };
  }
  // Add other common providers if needed
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
  const config: imaps.ImapSimpleOptions = {
    imap: {
      user: email,
      password: password,
      host: serverConfig.host,
      port: serverConfig.port,
      tls: serverConfig.tls,
      authTimeout: serverConfig.authTimeout,
    },
    onmail: function () {
      /* Do Nothing */
    },
    onexpunge: function () {
      /* Do Nothing */
    },
    onupdate: function () {
      /* Do Nothing */
    },
  };

  let connection: imaps.ImapSimple | null = null;
  try {
    console.log(
      `Connecting to IMAP server ${serverConfig.host} for user ${email}...`,
    );
    connection = await imaps.connect(config);
    console.log('Successfully connected to IMAP server.');

    await connection.openBox('INBOX');
    console.log('Opened INBOX.');

    const delay = 5 * 60 * 1000; // 5 minutes
    const searchDate = new Date();
    searchDate.setTime(Date.now() - delay);

    const searchCriteriaBase: any[] = [
      ['SINCE', searchDate.toISOString()],
      [
        'OR',
        ['HEADER', 'FROM', 'x.com'], // Updated from twitter.com
        ['HEADER', 'FROM', 'twitter.com'], // Keep twitter.com just in case
        ['HEADER', 'SUBJECT', 'confirmation code'],
        ['HEADER', 'SUBJECT', 'verification code'], // Added common alternative
      ],
    ];

    const fetchOptions = {
      bodies: ['HEADER.FIELDS (FROM SUBJECT DATE)', 'TEXT'],
      markSeen: false,
    };

    let messages: imaps.Message[] = [];

    // Try searching UNSEEN first
    const unreadSearchCriteria = ['UNSEEN', ...searchCriteriaBase];
    console.log(
      'Searching for UNSEEN emails with criteria:',
      JSON.stringify(unreadSearchCriteria),
    );
    try {
      messages = await connection.search(unreadSearchCriteria, fetchOptions);
      console.log(`Found ${messages.length} potential unread emails.`);
    } catch (searchError) {
      console.warn('Error searching for UNSEEN emails:', searchError);
    }

    // If no UNSEEN messages found, search SEEN
    if (messages.length === 0) {
      const readSearchCriteria = ['SEEN', ...searchCriteriaBase];
      console.log(
        'No unread emails found, searching SEEN emails with criteria:',
        JSON.stringify(readSearchCriteria),
      );
      try {
        const readMessages = await connection.search(
          readSearchCriteria,
          fetchOptions,
        );
        console.log(`Found ${readMessages.length} potential read emails.`);
        messages = readMessages; // Use read messages if unread search yielded nothing or failed
      } catch (searchError) {
        console.warn('Error searching for SEEN emails:', searchError);
      }
    }

    if (messages.length === 0) {
      throw new Error(
        'No relevant confirmation emails found (checked UNSEEN and SEEN).',
      );
    }

    // Sort messages by date, newest first
    messages.sort((a, b) => {
      const dateA = new Date(
        a.parts.find(
          (part) => part.which === 'HEADER.FIELDS (FROM SUBJECT DATE)',
        )?.body?.date?.[0] || 0,
      );
      const dateB = new Date(
        b.parts.find(
          (part) => part.which === 'HEADER.FIELDS (FROM SUBJECT DATE)',
        )?.body?.date?.[0] || 0,
      );
      return dateB.getTime() - dateA.getTime();
    });

    for (const item of messages) {
      const textPart = item.parts.find((part) => part.which === 'TEXT');
      if (textPart?.body) {
        const subject =
          item.parts.find(
            (part) => part.which === 'HEADER.FIELDS (FROM SUBJECT DATE)',
          )?.body?.subject?.[0] || '[No Subject]';
        console.log(`Parsing email with subject: ${subject}`);
        try {
          const mail = await simpleParser(textPart.body);
          const emailText =
            mail.text || (typeof mail.html === 'string' ? mail.html : '') || '';

          const codeMatch = emailText.match(/\b(\d{6})\b/);
          if (codeMatch && codeMatch[1]) {
            console.log('Found 6-digit code:', codeMatch[1]);
            return codeMatch[1];
          } else {
            console.log('No 6-digit code found in this email body.');
          }
        } catch (parseError) {
          console.error(
            `Error parsing email body for subject "${subject}":`,
            parseError,
          );
        }
      }
    }

    throw new Error(
      'Could not find a 6-digit confirmation code in recent emails.',
    );
  } catch (err) {
    console.error('IMAP Error:', err);
    throw new Error(
      `IMAP connection failed for ${email}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  } finally {
    if (connection && connection.imap.state !== 'disconnected') {
      // Corrected state check
      try {
        console.log('Closing IMAP connection.');
        await connection.end();
      } catch (endError) {
        console.error('Error closing IMAP connection:', endError);
      }
    } else {
      console.log('IMAP connection not established or already closed.');
    }
  }
}
