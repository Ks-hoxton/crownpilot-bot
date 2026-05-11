import { getConfig } from "../config.js";

type OpenAIResponsePayload = {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
};

export type ParsedMeetingCreateRequest = {
  title: string;
  description?: string;
  startAt: string;
  endAt: string;
  attendees?: string[];
};

export class OpenAIService {
  isConfigured(): boolean {
    return Boolean(getConfig().OPENAI_API_KEY);
  }

  async getExecutiveAdvice(input: {
    message: string;
    context: string;
  }): Promise<string> {
    const config = getConfig();

    if (!config.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: config.OPENAI_MODEL,
        reasoning: {
          effort: "medium"
        },
        instructions: [
          "You are CrownPilot, an AI executive copilot for CEOs and founders.",
          "Give concise, high-signal answers in Russian.",
          "Prioritize decisions, risks, next steps, and concrete recommendations.",
          "If data looks partial or mocked, say so briefly and still give the best actionable answer.",
          "When useful, structure the answer as:",
          "1) what matters",
          "2) why",
          "3) next step"
        ].join(" "),
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Executive context:\n${input.context}\n\nCEO request:\n${input.message}`
              }
            ]
          }
        ],
        text: {
          format: {
            type: "text"
          }
        }
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenAI request failed: ${errorBody}`);
    }

    const data = await response.json() as OpenAIResponsePayload;
    return extractOutputText(data) ?? "Не удалось получить ответ от AI-слоя.";
  }

  async suggestMeeting(input: {
    request: string;
  }): Promise<string> {
    const config = getConfig();

    if (!config.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: config.OPENAI_MODEL,
        reasoning: {
          effort: "medium"
        },
        instructions: [
          "You are CrownPilot, AI chief of staff.",
          "The user wants help creating a meeting.",
          "Respond in Russian.",
          "Suggest a clear meeting title and a concise meeting description/body.",
          "Output format:",
          "Тема: ...",
          "Описание:",
          "- ...",
          "- ..."
        ].join(" "),
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: input.request
              }
            ]
          }
        ],
        text: {
          format: {
            type: "text"
          }
        }
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenAI request failed: ${errorBody}`);
    }

    const data = await response.json() as OpenAIResponsePayload;
    return extractOutputText(data) ?? "Не удалось сгенерировать тему и описание встречи.";
  }

  async parseMeetingCreateRequest(input: {
    request: string;
    timeZone: string;
    nowIso?: string;
  }): Promise<ParsedMeetingCreateRequest> {
    const config = getConfig();

    if (!config.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: config.OPENAI_MODEL,
        reasoning: {
          effort: "medium"
        },
        instructions: [
          "You extract meeting creation data from a user's Russian message.",
          "Return valid JSON only.",
          "Use ISO 8601 for startAt and endAt.",
          "Assume the user's timezone is the provided timezone.",
          "If the message does not specify duration, use 60 minutes.",
          "If the title is missing, infer a concise professional title in Russian.",
          "Schema:",
          '{"title":"string","description":"string","startAt":"ISO datetime","endAt":"ISO datetime","attendees":["email"]}'
        ].join(" "),
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: [
                  `Timezone: ${input.timeZone}`,
                  `Current datetime: ${input.nowIso ?? new Date().toISOString()}`,
                  `User request: ${input.request}`
                ].join("\n")
              }
            ]
          }
        ],
        text: {
          format: {
            type: "text"
          }
        }
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenAI request failed: ${errorBody}`);
    }

    const data = await response.json() as OpenAIResponsePayload;
    const raw = extractOutputText(data);

    if (!raw) {
      throw new Error("OpenAI returned empty meeting payload");
    }

    const parsed = JSON.parse(stripCodeFence(raw)) as ParsedMeetingCreateRequest;
    return {
      title: parsed.title,
      description: parsed.description,
      startAt: parsed.startAt,
      endAt: parsed.endAt,
      attendees: parsed.attendees ?? []
    };
  }
}

function extractOutputText(data: OpenAIResponsePayload): string | undefined {
  if (data.output_text) {
    return data.output_text.trim();
  }

  const textParts = data.output
    ?.flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && item.text)
    .map((item) => item.text?.trim())
    .filter(Boolean);

  return textParts?.join("\n");
}

function stripCodeFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}
