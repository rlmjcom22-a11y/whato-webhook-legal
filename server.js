import express from "express";
import fetch from "node-fetch";

const app = express();

// Whato a veces manda JSON, a veces manda form-data / urlencoded.
// Soportamos ambos.
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 8080;
const MODEL = process.env.MODEL || "gpt-4o-mini";

const ADDRESS_BLOCK =
`📍Av de las Américas 1254, Col. Country Club, Guadalajara, Jalisco. C.P 44610. Piso 10.
Mapa: https://g.co/kgs/kyy6ef
☎️ 3341622071
🌎 https://tuabogadoenguadalajara.com`;

const BASE_PROMPT = `
Actúe como asistente de admisión de un despacho de Derecho Familiar en Guadalajara, Jalisco, México.

Responda SIEMPRE en trato formal, con empatía y claridad.

Su objetivo es:
1) Brindar orientación general sin asesoría definitiva.
2) Explicar que sí existen vías legales.
3) Conducir a agendar cita gratuita presencial.
4) Cerrar siempre con: “¿Su cita la desea por la mañana o por la tarde?”

Formato:
- Máximo 8 líneas.
- Profesional, cálido y directo.
- No prometer resultados.
- No dar montos exactos.
- No pedir datos sensibles.

Estructura obligatoria:
1) Validación breve.
2) Explicación general con “sí es posible promover legalmente…”
3) Invitación a cita gratuita.
4) Cierre obligatorio con la pregunta de horario.

Si el prospecto confirma que quiere cita:
Ofrecer horarios de lunes a viernes de 10:30 a.m. a 6:30 p.m.

Si pide domicilio:
Responder exactamente:

${ADDRESS_BLOCK}

Si se confirma la cita:
Responder:
“Su cita ha quedado establecida.
Le atenderá el abogado Raúl James.
Muchas gracias 😊”.
`.trim();

function normalizeText(v) {
  if (typeof v === "string") return v.trim();
  if (v == null) return "";
  return String(v).trim();
}

function pickIncomingMessage(body) {
  // Whato: en tu log ya aparece que llega "message"
  // También puede llegar como "message_content", "caption", etc.
  return (
    body?.message_content ??
    body?.message ??
    body?.text ??
    body?.body ??
    body?.caption ??
    body?.data?.message ??
    ""
  );
}

function looksLikeAddressRequest(text) {
  const t = text.toLowerCase();
  return (
    t.includes("domicilio") ||
    t.includes("dirección") ||
    t.includes("direccion") ||
    t.includes("ubicación") ||
    t.includes("ubicacion") ||
    t.includes("mapa") ||
    t.includes("donde estan") ||
    t.includes("dónde están") ||
    t.includes("donde están")
  );
}

function looksLikeAppointmentConfirmed(text) {
  const t = text.toLowerCase();
  return (
    t.includes("quiero cita") ||
    t.includes("sí quiero la cita") ||
    t.includes("si quiero la cita") ||
    t.includes("me interesa la cita") ||
    t.includes("agendar cita") ||
    t.includes("agendar") ||
    t.includes("confirmo")
  );
}

function looksLikeHardConfirm(text) {
  const t = text.toLowerCase();
  return (
    t.includes("queda confirmada") ||
    t.includes("confirmada") ||
    t.includes("queda agendada") ||
    t.includes("ya quedó") ||
    t.includes("ya quedo") ||
    t.includes("perfecto gracias") ||
    t.includes("listo gracias") ||
    t.includes("de acuerdo gracias")
  );
}

async function callOpenAI(userMessage) {
  const apiKey = process.env.OPENAI_API_KEY;

  // Si falta API Key, respondemos sin romper el server.
  if (!apiKey) {
    return "Entiendo su situación. Sí es posible promover legalmente alternativas conforme al caso. Le invito a una cita gratuita presencial para revisarlo. ¿Su cita la desea por la mañana o por la tarde?";
  }

  const payload = {
    model: MODEL,
    // En Responses API, lo más estable es usar "input" como string y "instructions" como system prompt.
    instructions: BASE_PROMPT,
    input: `Mensaje del prospecto: ${userMessage}`,
    max_output_tokens: 220
  };

  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  const data = await r.json();

  // Extraer texto de forma robusta
  const out =
    data?.output?.[0]?.content?.find?.(c => c.type === "output_text")?.text ??
    data?.output_text ??
    "";

  let text = normalizeText(out);

  if (!text) {
    text =
      "Entiendo su situación y con gusto le orientamos. Sí es posible promover legalmente acciones conforme al caso. Le invito a una cita gratuita presencial para revisar su situación. ¿Su cita la desea por la mañana o por la tarde?";
  }

  // máximo 8 líneas
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length > 8) text = lines.slice(0, 8).join("\n");

  return text;
}

// Health endpoints
app.get("/health", (req, res) => res.status(200).json({ ok: true, service: "whato-webhook-legal", status: "healthy" }));
app.get("/webhook", (req, res) => res.status(200).json({ ok: true, message: "Webhook activo" }));

// Main webhook
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body || {};

    // Log mínimo para ver qué llega (sin datos sensibles)
    console.log("INCOMING /webhook keys:", Object.keys(body || {}));

    const userMessage = normalizeText(pickIncomingMessage(body));

    // 1) Domicilio
    if (looksLikeAddressRequest(userMessage)) {
      return res.status(200).json({ ok: true, reply: ADDRESS_BLOCK, message: ADDRESS_BLOCK, text: ADDRESS_BLOCK });
    }

    // 2) Confirmación fuerte
    if (looksLikeHardConfirm(userMessage)) {
      const confirmText = "Su cita ha quedado establecida.\nLe atenderá el abogado Raúl James.\nMuchas gracias 😊";
      return res.status(200).json({ ok: true, reply: confirmText, message: confirmText, text: confirmText });
    }

    // 3) Quiere cita (agrega horarios)
    if (looksLikeAppointmentConfirmed(userMessage)) {
      const extra = "Horarios: lunes a viernes de 10:30 a.m. a 6:30 p.m.";
      const ai = await callOpenAI(userMessage);
      const combined = `${ai}\n${extra}`.split("\n").slice(0, 8).join("\n");
      return res.status(200).json({ ok: true, reply: combined, message: combined, text: combined });
    }

    // 4) General
    const reply = await callOpenAI(userMessage);
    return res.status(200).json({ ok: true, reply, message: reply, text: reply });

  } catch (err) {
    console.error("Webhook error:", err);
    const fallback =
      "Gracias por su mensaje. Sí es posible promover legalmente alternativas conforme al caso. Le invito a una cita gratuita presencial. ¿Su cita la desea por la mañana o por la tarde?";
    return res.status(200).json({ ok: false, reply: fallback, message: fallback, text: fallback });
  }
});

// Manejo limpio de SIGTERM (Railway reinicia/rota contenedores)
const server = app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));
process.on("SIGTERM", () => {
  console.log("SIGTERM recibido, cerrando server...");
  server.close(() => process.exit(0));
});
