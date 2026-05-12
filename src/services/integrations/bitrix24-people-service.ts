import type { AnniversaryEntry, BirthdayEntry, BitrixPerson } from "../../types.js";
import { Bitrix24RestClient } from "./bitrix24-rest-client.js";

type BitrixUsersResponse = {
  result?: Array<Record<string, unknown>>;
  error?: string;
  error_description?: string;
};

const ANNIVERSARY_MILESTONES = new Set([1, 3, 5, 10, 15, 20, 25, 30]);

export class Bitrix24PeopleService {
  private readonly restClient = new Bitrix24RestClient();

  async getBirthdaysForDay(telegramUserId: number, dayOffset: 0 | 1, timeZone: string): Promise<BirthdayEntry[]> {
    const target = shiftDate(getNowInTimeZone(timeZone), dayOffset);
    const people = await this.getPeople(telegramUserId);

    return people
      .filter((person) => matchesMonthDay(person.birthday, target))
      .map((person) => ({
        person,
        age: person.birthday ? getAgeOnDate(person.birthday, target) : undefined
      }))
      .sort((left, right) => left.person.name.localeCompare(right.person.name, "ru"));
  }

  async getAnniversariesForToday(telegramUserId: number, timeZone: string): Promise<AnniversaryEntry[]> {
    return this.getAnniversariesForDay(telegramUserId, 0, timeZone);
  }

  async getAnniversariesForDay(
    telegramUserId: number,
    dayOffset: 0 | 1,
    timeZone: string
  ): Promise<AnniversaryEntry[]> {
    const target = shiftDate(getNowInTimeZone(timeZone), dayOffset);
    const people = await this.getPeople(telegramUserId);

    return people
      .map((person) => {
        const sourceDate = person.employmentDate ?? person.registeredAt;
        if (!sourceDate || !matchesMonthDay(sourceDate, target)) {
          return undefined;
        }

        const years = getYearsOnDate(sourceDate, target);
        if (!ANNIVERSARY_MILESTONES.has(years)) {
          return undefined;
        }

        return { person, years };
      })
      .filter((item): item is AnniversaryEntry => Boolean(item))
      .sort((left, right) => left.person.name.localeCompare(right.person.name, "ru"));
  }

  private async getPeople(telegramUserId: number): Promise<BitrixPerson[]> {
    const data = await this.restClient.callMethod<BitrixUsersResponse>(telegramUserId, "user.get", {
      FILTER: {
        ACTIVE: true
      }
    });

    return (data.result ?? [])
      .map(normalizePerson)
      .filter((person) => person.id && person.name);
  }
}

function normalizePerson(item: Record<string, unknown>): BitrixPerson {
  return {
    id: String(item.ID ?? item.id ?? ""),
    name: [item.NAME, item.LAST_NAME]
      .filter((part) => typeof part === "string" && part.trim().length > 0)
      .join(" ")
      .trim(),
    birthday: asNonEmptyString(item.PERSONAL_BIRTHDAY),
    employmentDate: asNonEmptyString(item.UF_EMPLOYMENT_DATE) ?? asNonEmptyString(item.WORK_DATE),
    registeredAt: asNonEmptyString(item.DATE_REGISTER),
    workPosition: asNonEmptyString(item.WORK_POSITION)
  };
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function getNowInTimeZone(timeZone: string): Date {
  const rendered = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const year = Number(rendered.find((part) => part.type === "year")?.value ?? "0");
  const month = Number(rendered.find((part) => part.type === "month")?.value ?? "1");
  const day = Number(rendered.find((part) => part.type === "day")?.value ?? "1");
  return new Date(Date.UTC(year, month - 1, day));
}

function shiftDate(date: Date, days: number): Date {
  const shifted = new Date(date.getTime());
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted;
}

function matchesMonthDay(rawDate: string | undefined, target: Date): boolean {
  if (!rawDate) {
    return false;
  }

  const parsed = parseBitrixDate(rawDate);
  if (!parsed) {
    return false;
  }

  return parsed.month === target.getUTCMonth() + 1 && parsed.day === target.getUTCDate();
}

function getAgeOnDate(rawDate: string, target: Date): number | undefined {
  const parsed = parseBitrixDate(rawDate);
  if (!parsed?.year) {
    return undefined;
  }

  return target.getUTCFullYear() - parsed.year;
}

function getYearsOnDate(rawDate: string, target: Date): number {
  const parsed = parseBitrixDate(rawDate);
  if (!parsed?.year) {
    return 0;
  }

  return target.getUTCFullYear() - parsed.year;
}

function parseBitrixDate(rawDate: string): { year?: number; month: number; day: number } | undefined {
  const isoMatch = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return {
      year: Number(isoMatch[1]),
      month: Number(isoMatch[2]),
      day: Number(isoMatch[3])
    };
  }

  const dottedMatch = rawDate.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dottedMatch) {
    return {
      year: Number(dottedMatch[3]),
      month: Number(dottedMatch[2]),
      day: Number(dottedMatch[1])
    };
  }

  const noYearMatch = rawDate.match(/^(\d{2})\.(\d{2})$/);
  if (noYearMatch) {
    return {
      month: Number(noYearMatch[2]),
      day: Number(noYearMatch[1])
    };
  }

  return undefined;
}
