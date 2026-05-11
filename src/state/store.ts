import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { BitrixConnection, GoogleAccountConnection, GoogleCalendarRole } from "../types.js";

type GoogleOauthState = {
  telegramUserId: number;
  role: GoogleCalendarRole;
};

type ReminderState = {
  sentMeetingReminderKeys: Set<string>;
  sentMorningAgendaKeys: Set<string>;
  sentTaskReminderKeys: Set<string>;
};

type LegacyPersistentState = {
  googleConnections: Array<[number, GoogleAccountConnection[]]>;
  bitrixConnections: Array<[number, BitrixConnection]>;
  knownTelegramUsers: number[];
  reminderState: {
    sentMeetingReminderKeys: string[];
    sentMorningAgendaKeys: string[];
    sentTaskReminderKeys: string[];
  };
};

type EncryptedStatePayload = {
  version: 1;
  alg: "aes-256-gcm";
  iv: string;
  tag: string;
  data: string;
};

const googleStates = new Map<string, GoogleOauthState>();
const reminderState: ReminderState = {
  sentMeetingReminderKeys: new Set<string>(),
  sentMorningAgendaKeys: new Set<string>(),
  sentTaskReminderKeys: new Set<string>()
};

const dataDir = path.join(process.cwd(), "data");
const stateFilePath = path.join(dataDir, "state.json");
const dbFilePath = path.join(dataDir, "state.db");

mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(dbFilePath);
initializeDatabase();
hydrateReminderStateFromDb();
migrateLegacyJsonIfNeeded();

export const store = {
  saveGoogleOauthState(state: string, data: GoogleOauthState) {
    googleStates.set(state, data);
    this.rememberTelegramUser(data.telegramUserId);
  },

  consumeGoogleOauthState(state: string): GoogleOauthState | undefined {
    const oauthState = googleStates.get(state);
    googleStates.delete(state);
    return oauthState;
  },

  saveGoogleConnection(connection: GoogleAccountConnection) {
    this.rememberTelegramUser(connection.telegramUserId);

    db.prepare(`
      DELETE FROM google_connections
      WHERE telegram_user_id = ? AND (
        connection_id = ?
        OR (email = ? AND role = ?)
      )
    `).run(
      connection.telegramUserId,
      connection.connectionId,
      connection.email ?? null,
      connection.role
    );

    db.prepare(`
      INSERT INTO google_connections (
        telegram_user_id,
        connection_id,
        email,
        role,
        encrypted_payload
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      connection.telegramUserId,
      connection.connectionId,
      connection.email ?? null,
      connection.role,
      encryptText(JSON.stringify(connection))
    );
  },

  getGoogleConnections(telegramUserId: number): GoogleAccountConnection[] {
    const rows = db.prepare(`
      SELECT encrypted_payload
      FROM google_connections
      WHERE telegram_user_id = ?
      ORDER BY role, connection_id
    `).all(telegramUserId) as Array<{ encrypted_payload: string }>;

    return rows.map((row) => JSON.parse(decryptText(row.encrypted_payload)) as GoogleAccountConnection);
  },

  getGoogleConnectionById(telegramUserId: number, connectionId: string): GoogleAccountConnection | undefined {
    return this.getGoogleConnections(telegramUserId).find((item) => item.connectionId === connectionId);
  },

  getEnabledGoogleConnections(telegramUserId: number): GoogleAccountConnection[] {
    return this.getGoogleConnections(telegramUserId).filter((item) => item.calendars.some((calendar) => calendar.enabled));
  },

  updateGoogleCalendarEnabled(
    telegramUserId: number,
    connectionId: string,
    calendarId: string,
    enabled: boolean
  ) {
    const connection = this.getGoogleConnectionById(telegramUserId, connectionId);

    if (!connection) {
      return;
    }

    const updated: GoogleAccountConnection = {
      ...connection,
      calendars: connection.calendars.map((calendar) =>
        calendar.id === calendarId
          ? { ...calendar, enabled }
          : calendar
      )
    };

    this.saveGoogleConnection(updated);
  },

  clearGoogleConnections(telegramUserId: number) {
    db.prepare("DELETE FROM google_connections WHERE telegram_user_id = ?").run(telegramUserId);
  },

  saveBitrixConnection(connection: BitrixConnection) {
    this.rememberTelegramUser(connection.telegramUserId);

    db.prepare(`
      INSERT INTO bitrix_connections (
        telegram_user_id,
        encrypted_payload
      ) VALUES (?, ?)
      ON CONFLICT(telegram_user_id) DO UPDATE SET encrypted_payload = excluded.encrypted_payload
    `).run(
      connection.telegramUserId,
      encryptText(JSON.stringify(connection))
    );
  },

  getBitrixConnection(telegramUserId: number): BitrixConnection | undefined {
    const row = db.prepare(`
      SELECT encrypted_payload
      FROM bitrix_connections
      WHERE telegram_user_id = ?
    `).get(telegramUserId) as { encrypted_payload: string } | undefined;

    if (!row) {
      return undefined;
    }

    return JSON.parse(decryptText(row.encrypted_payload)) as BitrixConnection;
  },

  updateBitrixMappedUser(telegramUserId: number, mappedUserId: string, mappedUserName?: string) {
    const existing = this.getBitrixConnection(telegramUserId);

    if (!existing) {
      return;
    }

    this.saveBitrixConnection({
      ...existing,
      mappedUserId,
      mappedUserName
    });
  },

  rememberTelegramUser(telegramUserId: number) {
    db.prepare(`
      INSERT INTO known_users (telegram_user_id)
      VALUES (?)
      ON CONFLICT(telegram_user_id) DO NOTHING
    `).run(telegramUserId);
  },

  getKnownTelegramUsers(): number[] {
    const rows = db.prepare(`
      SELECT telegram_user_id
      FROM known_users
      ORDER BY telegram_user_id
    `).all() as Array<{ telegram_user_id: number }>;

    return rows.map((row) => Number(row.telegram_user_id));
  },

  getReminderState() {
    return reminderState;
  },

  markMeetingReminderSent(key: string) {
    reminderState.sentMeetingReminderKeys.add(key);
    persistReminderKey("meeting", key);
    pruneReminderState();
  },

  markMorningAgendaSent(key: string) {
    reminderState.sentMorningAgendaKeys.add(key);
    persistReminderKey("morning", key);
    pruneReminderState();
  },

  markTaskReminderSent(key: string) {
    reminderState.sentTaskReminderKeys.add(key);
    persistReminderKey("task", key);
    pruneReminderState();
  }
};

function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS google_connections (
      telegram_user_id INTEGER NOT NULL,
      connection_id TEXT NOT NULL,
      email TEXT,
      role TEXT NOT NULL,
      encrypted_payload TEXT NOT NULL,
      PRIMARY KEY (telegram_user_id, connection_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS bitrix_connections (
      telegram_user_id INTEGER PRIMARY KEY,
      encrypted_payload TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS known_users (
      telegram_user_id INTEGER PRIMARY KEY
    ) STRICT;

    CREATE TABLE IF NOT EXISTS reminder_state (
      key_type TEXT NOT NULL,
      reminder_key TEXT NOT NULL,
      PRIMARY KEY (key_type, reminder_key)
    ) STRICT;
  `);
}

function hydrateReminderStateFromDb() {
  const rows = db.prepare(`
    SELECT key_type, reminder_key
    FROM reminder_state
  `).all() as Array<{ key_type: string; reminder_key: string }>;

  for (const row of rows) {
    if (row.key_type === "meeting") {
      reminderState.sentMeetingReminderKeys.add(row.reminder_key);
    } else if (row.key_type === "morning") {
      reminderState.sentMorningAgendaKeys.add(row.reminder_key);
    } else if (row.key_type === "task") {
      reminderState.sentTaskReminderKeys.add(row.reminder_key);
    }
  }

  pruneReminderState();
}

function persistReminderKey(keyType: "meeting" | "morning" | "task", reminderKey: string) {
  db.prepare(`
    INSERT INTO reminder_state (key_type, reminder_key)
    VALUES (?, ?)
    ON CONFLICT(key_type, reminder_key) DO NOTHING
  `).run(keyType, reminderKey);
}

function pruneReminderState() {
  const today = new Date().toISOString().slice(0, 10);
  pruneSetByDate(reminderState.sentMorningAgendaKeys, "morning", today);
  pruneSetByDate(reminderState.sentTaskReminderKeys, "task", today);
  pruneMeetingReminderSet(reminderState.sentMeetingReminderKeys, today);
}

function pruneSetByDate(target: Set<string>, keyType: "morning" | "task", minDate: string) {
  for (const key of target) {
    const parts = key.split(":");
    const keyDate = parts[1];

    if (keyDate && keyDate < minDate) {
      target.delete(key);
      db.prepare("DELETE FROM reminder_state WHERE key_type = ? AND reminder_key = ?").run(keyType, key);
    }
  }
}

function pruneMeetingReminderSet(target: Set<string>, today: string) {
  for (const key of target) {
    const parts = key.split(":");
    const maybeDate = parts[parts.length - 1];

    if (maybeDate && /^\d{4}-\d{2}-\d{2}$/.test(maybeDate) && maybeDate < today) {
      target.delete(key);
      db.prepare("DELETE FROM reminder_state WHERE key_type = ? AND reminder_key = ?").run("meeting", key);
    }
  }
}

function migrateLegacyJsonIfNeeded() {
  const hasDbData = hasAnyDbState();

  if (hasDbData || !existsSync(stateFilePath)) {
    return;
  }

  try {
    const raw = readFileSync(stateFilePath, "utf8");
    const parsed = parseLegacyState(raw);

    for (const [telegramUserId, connections] of parsed.googleConnections ?? []) {
      for (const connection of connections) {
        store.saveGoogleConnection({
          ...connection,
          telegramUserId: Number(telegramUserId)
        });
      }
    }

    for (const [telegramUserId, connection] of parsed.bitrixConnections ?? []) {
      store.saveBitrixConnection({
        ...connection,
        telegramUserId: Number(telegramUserId)
      });
    }

    for (const telegramUserId of parsed.knownTelegramUsers ?? []) {
      store.rememberTelegramUser(Number(telegramUserId));
    }

    for (const key of parsed.reminderState?.sentMeetingReminderKeys ?? []) {
      reminderState.sentMeetingReminderKeys.add(key);
      persistReminderKey("meeting", key);
    }

    for (const key of parsed.reminderState?.sentMorningAgendaKeys ?? []) {
      reminderState.sentMorningAgendaKeys.add(key);
      persistReminderKey("morning", key);
    }

    for (const key of parsed.reminderState?.sentTaskReminderKeys ?? []) {
      reminderState.sentTaskReminderKeys.add(key);
      persistReminderKey("task", key);
    }

    pruneReminderState();
  } catch (error) {
    console.error("Failed to migrate legacy state.json into SQLite", error);
  }
}

function hasAnyDbState(): boolean {
  const googleCount = Number((db.prepare("SELECT COUNT(*) AS count FROM google_connections").get() as { count: number }).count);
  const bitrixCount = Number((db.prepare("SELECT COUNT(*) AS count FROM bitrix_connections").get() as { count: number }).count);
  const usersCount = Number((db.prepare("SELECT COUNT(*) AS count FROM known_users").get() as { count: number }).count);
  const reminderCount = Number((db.prepare("SELECT COUNT(*) AS count FROM reminder_state").get() as { count: number }).count);

  return googleCount > 0 || bitrixCount > 0 || usersCount > 0 || reminderCount > 0;
}

function parseLegacyState(raw: string): LegacyPersistentState {
  const parsed = JSON.parse(raw) as LegacyPersistentState | EncryptedStatePayload;

  if (isEncryptedPayload(parsed)) {
    return JSON.parse(decryptText(parsed.data, {
      iv: parsed.iv,
      tag: parsed.tag,
      alreadyWrapped: true
    })) as LegacyPersistentState;
  }

  return parsed as LegacyPersistentState;
}

function isEncryptedPayload(value: unknown): value is EncryptedStatePayload {
  return typeof value === "object" &&
    value !== null &&
    "version" in value &&
    "alg" in value &&
    "iv" in value &&
    "tag" in value &&
    "data" in value;
}

function encryptText(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getStateEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    version: 1,
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: encrypted.toString("base64")
  } satisfies EncryptedStatePayload);
}

function decryptText(
  ciphertext: string,
  options?: { iv: string; tag: string; alreadyWrapped: true }
): string {
  const payload = options?.alreadyWrapped
    ? { iv: options.iv, tag: options.tag, data: ciphertext }
    : JSON.parse(ciphertext) as EncryptedStatePayload;

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getStateEncryptionKey(),
    Buffer.from(payload.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.data, "base64")),
    decipher.final()
  ]);

  return decrypted.toString("utf8");
}

function getStateEncryptionKey(): Buffer {
  const secret =
    process.env.STATE_ENCRYPTION_KEY ||
    process.env.TELEGRAM_BOT_TOKEN ||
    "crownpilot-local-dev-fallback-key";
  return crypto.createHash("sha256").update(secret).digest();
}
