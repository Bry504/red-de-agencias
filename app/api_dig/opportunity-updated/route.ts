/* eslint-disable @typescript-eslint/no-unused-vars */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

const WEBHOOK_TOKEN =
  process.env.GHL_WEBHOOK_TOKEN ?? "pit-f995f6e7-c20a-4b1e-8a5e-a18659542bf5";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Faltan variables de entorno de Supabase");
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Helpers
type Dict = Record<string, unknown>;
const isObj = (v: unknown): v is Dict => typeof v === "object" && v !== null;

const get = (o: unknown, p: string): unknown => {
  if (!isObj(o)) return undefined;
  return p.split(".").reduce<unknown>((acc, key) => {
    if (!isObj(acc)) return undefined;
    return (acc as Dict)[key];
  }, o);
};

const S = (o: unknown, p: string): string | undefined => {
  const v = get(o, p);
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};

const N = (o: unknown, p: string): number | undefined => {
  const v = get(o, p);
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, "."));
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
};

// --------- Handler ---------
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");

    if (token !== WEBHOOK_TOKEN) {
      console.error("[opportunity-updated] TOKEN INVALIDO");
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const root = (await req.json()) as unknown;

    console.log("[opportunity-updated] Payload:", JSON.stringify(root, null, 2));

    // BUSCA EL ID DE VARIAS FORMAS
    const hlOpportunityId =
      S(root, "customData.hl_opportunity_id") ??
      S(root, "hl_opportunity_id") ??
      S(root, "id") ??
      S(root, "opportunity.id") ??
      S(root, "opportunityId");

    console.log("[opportunity-updated] ID detectado:", hlOpportunityId);

    // Si aun así no existe → SKIP sin error
    if (!hlOpportunityId) {
      console.warn("[opportunity-updated] SKIP: No ID → No se actualiza nada");
      return NextResponse.json(
        {
          ok: true,
          updated: false,
          reason: "skip: no hl_opportunity_id",
        },
        { status: 200 }
      );
    }

    // Buscar oportunidad
    const { data: opExistente } = await supabaseAdmin
      .from("oportunidades")
      .select("id")
      .eq("hl_opportunity_id", hlOpportunityId)
      .maybeSingle();

    if (!opExistente) {
      console.warn("[opportunity-updated] SKIP: no existe oportunidad con ese ID");
      return NextResponse.json(
        { ok: true, updated: false, reason: "skip: no existe oportunidad" },
        { status: 200 }
      );
    }

    // Extraer campos desde customData
    const nombreCompleto =
      S(root, "customData.nombre_completo") ??
      S(root, "full_name") ??
      S(root, "opportunity_name");

    const estado = S(root, "customData.estado") ?? S(root, "status");
    const nivelDeInteres = S(root, "customData.nivel_de_interes");
    const tipoDeCliente = S(root, "customData.tipo_de_cliente");
    const producto = S(root, "customData.producto");
    const proyecto = S(root, "customData.proyecto");
    const modalidadDePago = S(root, "customData.modalidad_de_pago");
    const motivoDeSeguimiento = S(root, "customData.motivo_de_seguimiento");
    const principalesObjeciones = S(root, "customData.principales_objeciones");
    const pipeline = S(root, "customData.pipeline");

    const arras = N(root, "customData.arras") ?? null;

    // contacto_id
    let contactoId: string | null = null;
    const hlContactId = S(root, "customData.hl_contact_id") ?? S(root, "contact_id");

    if (hlContactId) {
      const { data: contacto } = await supabaseAdmin
        .from("contactos")
        .select("id")
        .eq("hl_contact_id", hlContactId)
        .maybeSingle();

      contactoId = contacto?.id ?? null;
    }

    // propietario_id
    let propietarioId: string | null = null;
    const ghlId = S(root, "customData.ghl_id");

    if (ghlId) {
      const { data: usuario } = await supabaseAdmin
        .from("usuarios")
        .select("id")
        .eq("ghl_id", ghlId)
        .maybeSingle();

      propietarioId = usuario?.id ?? null;
    }

    // Construir payload
    const updatePayload: Record<string, unknown> = {
      nombre_completo: nombreCompleto ?? null,
      estado: estado ?? null,
      nivel_de_interes: nivelDeInteres ?? null,
      tipo_de_cliente: tipoDeCliente ?? null,
      producto: producto ?? null,
      proyecto: proyecto ?? null,
      modalidad_de_pago: modalidadDePago ?? null,
      motivo_de_seguimiento: motivoDeSeguimiento ?? null,
      principales_objeciones: principalesObjeciones ?? null,
      arras,
      pipeline: pipeline ?? null,
      contacto_id: contactoId,
      propietario_id: propietarioId,
    };

    console.log("[opportunity-updated] UPDATE PAYLOAD:", updatePayload);

    // Ejecuta update
    await supabaseAdmin
      .from("oportunidades")
      .update(updatePayload)
      .eq("hl_opportunity_id", hlOpportunityId);

    console.log("[opportunity-updated] UPDATE OK");

    return NextResponse.json({ ok: true, updated: true }, { status: 200 });
  } catch (err) {
    console.error("[opportunity-updated] ERROR:", err);
    return NextResponse.json({ ok: false, error: "error interno" }, { status: 500 });
  }
}