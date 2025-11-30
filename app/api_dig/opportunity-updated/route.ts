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
      console.error("[DIG opportunity-changed] TOKEN INVALIDO:", token);
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const root = (await req.json()) as unknown;

    console.log(
      "[DIG opportunity-changed] Payload recibido:",
      JSON.stringify(root, null, 2)
    );

    // BUSCA EL ID DE VARIAS FORMAS (hl_opportunity_id)
    const hlOpportunityId =
      S(root, "customData.hl_opportunity_id") ??
      S(root, "hl_opportunity_id") ??
      S(root, "id") ??
      S(root, "opportunity.id") ??
      S(root, "opportunityId");

    console.log("[DIG opportunity-changed] hl_opportunity_id detectado:", hlOpportunityId);

    // Si aun así no existe → SKIP sin error
    if (!hlOpportunityId) {
      console.warn("[DIG opportunity-changed] SKIP: No hl_opportunity_id → No se actualiza nada");
      return NextResponse.json(
        {
          ok: true,
          updated: false,
          reason: "skip: no hl_opportunity_id",
        },
        { status: 200 }
      );
    }

    // Buscar oportunidad (necesitamos id y pipeline actual)
    const { data: opExistente, error: findError } = await supabaseAdmin
      .from("oportunidades")
      .select("id, pipeline")
      .eq("hl_opportunity_id", hlOpportunityId)
      .maybeSingle();

    if (findError) {
      console.error(
        "[DIG opportunity-changed] Error buscando oportunidad:",
        findError
      );
      return NextResponse.json(
        { ok: false, error: "Error buscando oportunidad" },
        { status: 500 }
      );
    }

    if (!opExistente) {
      console.warn(
        "[DIG opportunity-changed] SKIP: no existe oportunidad con ese hl_opportunity_id"
      );
      return NextResponse.json(
        { ok: true, updated: false, reason: "skip: no existe oportunidad" },
        { status: 200 }
      );
    }

    const oportunidadId = opExistente.id as string;
    const pipelineAnterior = (opExistente.pipeline ?? null) as string | null;

    console.log("[DIG opportunity-changed] Oportunidad encontrada:", {
      oportunidadId,
      pipelineAnterior,
    });

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
    const pipelineNuevo = S(root, "customData.pipeline");

    const arras = N(root, "customData.arras") ?? null;

    console.log("[DIG opportunity-changed] Campos base:", {
      nombreCompleto,
      estado,
      nivelDeInteres,
      tipoDeCliente,
      producto,
      proyecto,
      modalidadDePago,
      motivoDeSeguimiento,
      principalesObjeciones,
      pipelineNuevo,
      arras,
    });

    // contacto_id
    let contactoId: string | null = null;
    const hlContactId = S(root, "customData.hl_contact_id") ?? S(root, "contact_id");

    if (hlContactId) {
      const { data: contacto, error: contactoError } = await supabaseAdmin
        .from("contactos")
        .select("id")
        .eq("hl_contact_id", hlContactId)
        .maybeSingle();

      if (contactoError) {
        console.error(
          "[DIG opportunity-changed] Error buscando contacto:",
          contactoError
        );
      }

      contactoId = contacto?.id ?? null;
      console.log("[DIG opportunity-changed] contacto_id resuelto:", contactoId);
    }

    // propietario_id
    let propietarioId: string | null = null;
    const ghlId = S(root, "customData.ghl_id");

    if (ghlId) {
      const { data: usuario, error: usuarioError } = await supabaseAdmin
        .from("usuarios")
        .select("id")
        .eq("ghl_id", ghlId)
        .maybeSingle();

      if (usuarioError) {
        console.error(
          "[DIG opportunity-changed] Error buscando usuario:",
          usuarioError
        );
      }

      propietarioId = usuario?.id ?? null;
      console.log("[DIG opportunity-changed] propietario_id resuelto:", propietarioId);
    }

    // Construir payload de actualización
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
      pipeline: pipelineNuevo ?? null,
      contacto_id: contactoId,
      propietario_id: propietarioId,
    };

    console.log("[DIG opportunity-changed] UPDATE PAYLOAD oportunidades:", updatePayload);

    // Ejecuta update en OPORTUNIDADES
    const { error: updateError } = await supabaseAdmin
      .from("oportunidades")
      .update(updatePayload)
      .eq("hl_opportunity_id", hlOpportunityId);

    if (updateError) {
      console.error("[DIG opportunity-changed] Error actualizando oportunidad:", updateError);
      return NextResponse.json(
        { ok: false, error: "Error actualizando oportunidad" },
        { status: 500 }
      );
    }

    console.log("[DIG opportunity-changed] UPDATE OK en oportunidades");

    // ====== LÓGICA CAMBIO DE PIPELINE (SIEMPRE, SIN FILTRAR POR ESTADO) ======
    let pipelineChanged = false;
    let cambiosPipelineId: string | null = null;

    // Antes probablemente filtrabas por estado = 'open'.
    // Ahora SOLO verificamos si el pipeline realmente cambió.
    if (pipelineAnterior && pipelineNuevo && pipelineAnterior !== pipelineNuevo) {
      pipelineChanged = true;

      const cambioPayload: Record<string, unknown> = {
        oportunidad: oportunidadId,
        estado: estado ?? null,
        pipeline_origen: pipelineAnterior,
        pipeline_destino: pipelineNuevo,
      };

      console.log(
        "[DIG opportunity-changed] Cambio de pipeline detectado. insertPayload cambios_pipeline =",
        cambioPayload
      );

      const { data: cambioInserted, error: cambioError } = await supabaseAdmin
        .from("cambios_pipeline")
        .insert(cambioPayload)
        .select("id")
        .single();

      if (cambioError) {
        console.error(
          "[DIG opportunity-changed] Error insertando en cambios_pipeline:",
          cambioError
        );
        // No rompemos el flujo normal: solo logueamos el error
      } else {
        cambiosPipelineId = (cambioInserted?.id as string) ?? null;
        console.log(
          "[DIG opportunity-changed] Registro OK en cambios_pipeline, id =",
          cambiosPipelineId
        );
      }
    } else {
      console.log(
        "[DIG opportunity-changed] No se registra cambio de pipeline. Valores:",
        { pipelineAnterior, pipelineNuevo }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        updated: true,
        oportunidad_id: oportunidadId,
        pipeline_changed: pipelineChanged,
        cambios_pipeline_id: cambiosPipelineId,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[DIG opportunity-changed] ERROR INESPERADO:", err);
    return NextResponse.json({ ok: false, error: "error interno" }, { status: 500 });
  }
}