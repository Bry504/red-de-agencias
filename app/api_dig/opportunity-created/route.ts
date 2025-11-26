/* eslint-disable @typescript-eslint/no-unused-vars */
import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

const WEBHOOK_TOKEN =
  process.env.GHL_WEBHOOK_TOKEN ?? "pit-f995f6e7-c20a-4b1e-8a5e-a18659542bf5";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Faltan variables de entorno de Supabase");
}

const supabaseAdmin: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// --------- Helpers seguros ---------

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
    const t = v.trim();
    const num = Number(t.replace(/,/g, "."));
    return Number.isNaN(num) ? undefined : num;
  }
  return undefined;
};

// --------- Handler ---------

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");

    if (token !== WEBHOOK_TOKEN) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const root = (await req.json()) as unknown;

    console.log(
      "[opportunity-created] Payload recibido:",
      JSON.stringify(root, null, 2)
    );

    // Leer desde customData primero
    const nombreCompleto =
      S(root, "customData.nombre_completo") ??
      S(root, "full_name") ??
      S(root, "opportunity_name");

    const hlContactId =
      S(root, "customData.hl_contact_id") ?? S(root, "contact_id");

    const ghlIdRaw = S(root, "customData.ghl_id");
    const ghlId =
      ghlIdRaw && ghlIdRaw.length > 0 ? ghlIdRaw : undefined; // dueño opcional

    const estado = S(root, "customData.estado") ?? S(root, "status");
    const nivelDeInteres = S(root, "customData.nivel_de_interes");
    const tipoDeCliente = S(root, "customData.tipo_de_cliente");
    const producto = S(root, "customData.producto");
    const proyecto =
      S(root, "customData.proyecto") ?? S(root, "Proyecto");
    const modalidadDePago = S(root, "customData.modalidad_de_pago");
    const motivoDeSeguimiento = S(
      root,
      "customData.motivo_de_seguimiento"
    );
    const principalesObjeciones = S(
      root,
      "customData.principales_objeciones"
    );
    const pipeline =
      S(root, "customData.pipeline") ??
      S(root, "pipeline_name") ??
      S(root, "pipleline_stage");

    const hlOpportunityId =
      S(root, "customData.hl_opportunity_id") ?? S(root, "id");

    const arrasNum = N(root, "customData.arras");
    const arras = typeof arrasNum === "number" ? arrasNum : null;

    // Resolver contacto_id
    let contactoId: string | null = null;

    if (hlContactId) {
      const { data: contacto } = await supabaseAdmin
        .from("contactos")
        .select("id")
        .eq("hl_contact_id", hlContactId)
        .maybeSingle();

      contactoId = contacto?.id ?? null;
    }

    // Resolver propietario_id SOLO si ghlId vino
    let propietarioId: string | null = null;

    if (ghlId) {
      const { data: usuario } = await supabaseAdmin
        .from("usuarios")
        .select("id")
        .eq("ghl_id", ghlId)
        .maybeSingle();

      propietarioId = usuario?.id ?? null;
    }

    // Construcción final
    const oportunidad = {
      nombre_completo: nombreCompleto ?? null,
      contacto_id: contactoId,
      propietario_id: propietarioId, // puede ser null
      estado: estado ?? null,
      nivel_de_interes: nivelDeInteres ?? null,
      tipo_de_cliente: tipoDeCliente ?? null,
      producto,
      proyecto,
      modalidad_de_pago: modalidadDePago ?? null,
      motivo_de_seguimiento: motivoDeSeguimiento ?? null,
      principales_objeciones: principalesObjeciones ?? null,
      arras,
      hl_opportunity_id: hlOpportunityId ?? null,
      pipeline: pipeline ?? null,
    };

    console.log(
      "[opportunity-created] Oportunidad a insertar:",
      oportunidad
    );

    // Insertar siempre
    const { data, error } = await supabaseAdmin
      .from("oportunidades")
      .insert(oportunidad)
      .select("id")
      .single();

    if (error) {
      console.error("[opportunity-created] Error insertando:", error);
      return NextResponse.json(
        { ok: false, error: "Error insertando oportunidad" },
        { status: 500 }
      );
    }

    console.log("[opportunity-created] Insert OK:", data?.id);

    return NextResponse.json(
      { ok: true, oportunidad_id: data?.id ?? null },
      { status: 201 }
    );
  } catch (err) {
    console.error("[opportunity-created] Error inesperado:", err);
    return NextResponse.json(
      { ok: false, error: "Error interno" },
      { status: 500 }
    );
  }
}