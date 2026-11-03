const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const MAX_QUESTION_LENGTH = 500;
const MAX_PROMPT_LENGTH = 16_000;
const REQUEST_TIMEOUT_MS = 45_000;
const requestCounts = new Map();

function sendError(response, status, message) {
  return response.status(status).json({ error: message });
}

function isRateLimited(request) {
  const clientIp = request.headers["x-real-ip"]
    || request.headers["x-forwarded-for"]?.split(",")[0]?.trim()
    || "unknown";
  const now = Date.now();
  const current = requestCounts.get(clientIp);

  if (!current || now - current.startedAt >= RATE_LIMIT_WINDOW_MS) {
    requestCounts.set(clientIp, { startedAt: now, count: 1 });
    return false;
  }
  if (current.count >= RATE_LIMIT_MAX_REQUESTS) return true;

  current.count += 1;
  return false;
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendError(response, 405, "Gemini 질문은 POST 요청만 지원합니다.");
  }
  if (isRateLimited(request)) {
    return sendError(response, 429, "질문 요청이 잠시 많습니다. 1분 후 다시 시도해 주세요.");
  }

  const body = request.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return sendError(response, 400, "질문 정보를 확인할 수 없습니다.");
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!question || question.length > MAX_QUESTION_LENGTH) {
    return sendError(response, 400, "질문을 입력해 주세요. 질문은 500자 이내로 작성할 수 있습니다.");
  }
  if (!prompt || prompt.length > MAX_PROMPT_LENGTH) {
    return sendError(response, 400, "기상정보를 포함한 질문 내용을 확인할 수 없습니다.");
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return sendError(response, 503, "Gemini 연결 설정이 필요합니다. Vercel 프로젝트 환경 변수에 GEMINI_API_KEY를 등록해 주세요.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const geminiResponse = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: "농업 기상 상담자로서 사용자 질문에 한국어로 답하세요. 기상청 관측소의 실측자료, 기상청 예보, Windy·Open-Meteo 수치예보를 출처와 관측 시각에 따라 구분하세요. 관측소 실측은 선택 좌표와 다른 위치의 가장 가까운 관측소 자료일 수 있고 지연될 수 있으므로 거리·시각을 고려해 설명하세요. 모델 예보를 실측처럼 말하지 말고, 불확실성과 필요한 현장 확인사항을 설명하며 제공되지 않은 기상값이나 작물·농약 기준을 만들어내지 마세요. 안전하고 실행 가능한 답변을 간결한 항목으로 작성하세요.",
            }],
          },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 1200 },
        }),
        signal: controller.signal,
      },
    );
    const result = await geminiResponse.json().catch(() => ({}));
    if (!geminiResponse.ok) {
      console.error("Gemini API request failed with status", geminiResponse.status);
      if (geminiResponse.status === 429) {
        return sendError(response, 429, "Gemini 사용량이 많습니다. 잠시 후 다시 시도해 주세요.");
      }
      if (geminiResponse.status === 400) {
        return sendError(response, 400, "질문을 처리할 수 없습니다. 내용을 조금 바꿔 다시 시도해 주세요.");
      }
      if (geminiResponse.status === 401 || geminiResponse.status === 403) {
        return sendError(response, 503, "Gemini API 키를 사용할 수 없습니다. Vercel 환경 변수 설정과 키 상태를 확인해 주세요.");
      }
      return sendError(response, 502, "Gemini 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }

    const answer = result.candidates?.[0]?.content?.parts
      ?.map((part) => part.text)
      .filter((text) => typeof text === "string")
      .join("\n")
      .trim();
    if (!answer) {
      return sendError(response, 502, "Gemini가 답변을 생성하지 못했습니다. 질문을 바꿔 다시 시도해 주세요.");
    }

    return response.status(200).json({ answer });
  } catch (error) {
    if (error.name === "AbortError") {
      return sendError(response, 504, "Gemini 답변 시간이 초과되었습니다. 다시 시도해 주세요.");
    }
    console.error("Gemini API connection failed.", error);
    return sendError(response, 502, "Gemini 서비스에 연결하지 못했습니다. 네트워크 상태를 확인하고 다시 시도해 주세요.");
  } finally {
    clearTimeout(timeout);
  }
};
