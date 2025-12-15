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

// Para assignedTo: necesitamos saber si vino vacío para setear NULL
const S_ALLOW_EMPTY = (o: unknown, p: string): string | null | undefined => {
  const v = get(o, p);
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : null; // vacío => null explícito
};

// --------- Handler ---------
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");

    if (token !== WEBHOOK_TOKEN) {
      console.error("[DIG opportunity-updated2] TOKEN INVALIDO:", token);
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const root = (await req.json()) as unknown;

    console.log(
      "[DIG opportunity-updated2] Payload recibido:",
      JSON.stringify(root, null, 2)
    );

    // ====== EXTRACCIÓN PRINCIPAL ======
    const hlOpportunityId =
      S(root, "customData.hl_opportunity_id") ??
      S(root, "hl_opportunity_id") ??
      S(root, "opportunity.id") ??
      S(root, "id") ??
      S(root, "opportunityId");

    const hlContactId =
      S(root, "customData.hl_contact_id") ??
      S(root, "hl_contact_id") ??
      S(root, "contact.id") ??
      S(root, "contact_id");

    const pipelineNuevo =
      S(root, "customData.pipeline") ??
      S(root, "pipeline");

    const stageNuevo =
      S(root, "customData.stage") ??
      S(root, "stage");

    const statusNuevo =
      S(root, "customData.status") ??
      S(root, "status") ??
      S(root, "customData.estado"); // por compatibilidad

    // assignedTo puede venir vacío -> NULL
    const assignedToRaw =
      S_ALLOW_EMPTY(root, "customData.assignedTo") ??
      S_ALLOW_EMPTY(root, "assignedTo") ??
      S_ALLOW_EMPTY(root, "customData.ghl_id") ?? // por si lo mandas como ghl_id
      S_ALLOW_EMPTY(root, "ghl_id");

    console.log("[DIG opportunity-updated2] Campos detectados:", {
      hlOpportunityId,
      hlContactId,
      pipelineNuevo,
      stageNuevo,
      statusNuevo,
      assignedToRaw,
    });

    // ====== RESOLVER CONTACTO (solo para encontrar oportunidad / setear contacto_id) ======
    let contactoId: string | null = null;

    if (hlContactId) {
      const { data: contacto, error: contactoError } = await supabaseAdmin
        .from("contactos")
        .select("id")
        .eq("hl_contact_id", hlContactId)
        .maybeSingle();

      if (contactoError) {
        console.error("[DIG opportunity-updated2] Error buscando contacto:", contactoError);
      }

      contactoId = (contacto?.id as string) ?? null;
      console.log("[DIG opportunity-updated2] contactoId resuelto:", contactoId);
    }

    // ====== ENCONTRAR OPORTUNIDAD ======
    let op: { id: string; pipeline: string | null; propietario_id: string | null } | null = null;

    if (hlOpportunityId) {
      const { data: opExistente, error: findOpError } = await supabaseAdmin
        .from("oportunidades")
        .select("id, pipeline, propietario_id")
        .eq("hl_opportunity_id", hlOpportunityId)
        .maybeSingle();

      if (findOpError) {
        console.error("[DIG opportunity-updated2] Error buscando oportunidad por hl_opportunity_id:", findOpError);
        return NextResponse.json({ ok: false, error: "Error buscando oportunidad" }, { status: 500 });
      }

      if (opExistente) {
        op = {
          id: opExistente.id as string,
          pipeline: (opExistente.pipeline ?? null) as string | null,
          propietario_id: (opExistente.propietario_id ?? null) as string | null,
        };
      }
    }

    // Fallback: si no vino hl_opportunity_id, intentamos por hl_contact_id -> contacto_id
    if (!op && !hlOpportunityId && contactoId) {
      const { data: opByContacto, error: findByContactoError } = await supabaseAdmin
        .from("oportunidades")
        .select("id, pipeline, propietario_id")
        .eq("contacto_id", contactoId)
        .maybeSingle();

      if (findByContactoError) {
        console.error("[DIG opportunity-updated2] Error buscando oportunidad por contacto_id:", findByContactoError);
        return NextResponse.json({ ok: false, error: "Error buscando oportunidad (contacto)" }, { status: 500 });
      }

      if (opByContacto) {
        op = {
          id: opByContacto.id as string,
          pipeline: (opByContacto.pipeline ?? null) as string | null,
          propietario_id: (opByContacto.propietario_id ?? null) as string | null,
        };
      }
    }

    if (!op) {
      console.warn("[DIG opportunity-updated2] SKIP: no se encontró oportunidad (ni por hl_opportunity_id ni por hl_contact_id)");
      return NextResponse.json(
        { ok: true, updated: false, reason: "skip: oportunidad no encontrada" },
        { status: 200 }
      );
    }

    const oportunidadId = op.id;
    const pipelineAnterior = op.pipeline;
    const propietarioAnterior = op.propietario_id;

    console.log("[DIG opportunity-updated2] Oportunidad encontrada:", {
      oportunidadId,
      pipelineAnterior,
      propietarioAnterior,
    });

    // ====== RESOLVER PROPIETARIO ACTUAL DESDE assignedTo (usuarios.ghl_id) ======
    // Regla: si assignedToRaw es undefined -> igual se debe poner NULL (porque “no manda propietario”)
    // Regla: si assignedToRaw es null (vino vacío) -> NULL
    let propietarioActual: string | null = null;

    if (assignedToRaw && typeof assignedToRaw === "string") {
      const { data: usuario, error: usuarioError } = await supabaseAdmin
        .from("usuarios")
        .select("id")
        .eq("ghl_id", assignedToRaw)
        .maybeSingle();

      if (usuarioError) {
        console.error("[DIG opportunity-updated2] Error buscando usuario por ghl_id:", usuarioError);
      }

      propietarioActual = (usuario?.id as string) ?? null;
    } else {
      // no vino o vino vacío => NULL explícito
      propietarioActual = null;
    }

    // ====== UPDATE OPORTUNIDADES (solo lo pedido) ======
    const updatePayload: Record<string, unknown> = {
      estado: statusNuevo ?? null,
      contacto_id: contactoId, // si no se resolvió, queda null (no rompe)
      propietario_id: propietarioActual, // pedido: si no manda, NULL
    };

    // pipeline solo si vino (para no borrar por payload incompleto)
    if (pipelineNuevo) {
      updatePayload.pipeline = pipelineNuevo;
    }

    console.log("[DIG opportunity-updated2] UPDATE PAYLOAD oportunidades:", updatePayload);

    const { error: updateError } = await supabaseAdmin
      .from("oportunidades")
      .update(updatePayload)
      .eq("id", oportunidadId);

    if (updateError) {
      console.error("[DIG opportunity-updated2] Error actualizando oportunidad:", updateError);
      return NextResponse.json({ ok: false, error: "Error actualizando oportunidad" }, { status: 500 });
    }

    // ====== REASIGNACIONES (si cambia propietario) ======
    let reasignacionCreada = false;

    if ((propietarioAnterior ?? null) !== (propietarioActual ?? null)) {
      const reasignacionPayload: Record<string, unknown> = {
        oportunidad: oportunidadId,
        propietario_anterior: propietarioAnterior ?? null,
        propietario_actual: propietarioActual ?? null,
      };

      console.log("[DIG opportunity-updated2] Cambio de propietario detectado. insertPayload reasignaciones =", reasignacionPayload);

      const { error: reError } = await supabaseAdmin
        .from("reasignaciones")
        .insert(reasignacionPayload);

      if (reError) {
        console.error("[DIG opportunity-updated2] Error insertando reasignación:", reError);
      } else {
        reasignacionCreada = true;
      }
    }

    // ====== CAMBIOS PIPELINE (si cambia pipeline y llegó pipelineNuevo) ======
    let pipelineChanged = false;

    if (pipelineNuevo && (pipelineAnterior ?? null) !== pipelineNuevo) {
      pipelineChanged = true;

      const cambioPayload: Record<string, unknown> = {
        oportunidad: oportunidadId,
        estado: statusNuevo ?? null,
        pipeline_origen: pipelineAnterior ?? null,
        pipeline_destino: pipelineNuevo,
      };

      console.log("[DIG opportunity-updated2] Cambio de pipeline detectado. insertPayload cambios_pipeline =", cambioPayload);

      const { error: cpError } = await supabaseAdmin
        .from("cambios_pipeline")
        .insert(cambioPayload);

      if (cpError) {
        console.error("[DIG opportunity-updated2] Error insertando en cambios_pipeline:", cpError);
      }
    }

    // ====== HISTORIAL ETAPAS (insertar solo si cambia; incluye etapa_origen) ======
    let etapaInserted = false;

    if (stageNuevo) {
      const { data: lastEtapa, error: lastEtapaError } = await supabaseAdmin
        .from("historial_etapas")
        .select("etapa_destino")
        .eq("oportunidad", oportunidadId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastEtapaError) {
        console.error("[DIG opportunity-updated2] Error obteniendo última etapa:", lastEtapaError);
      }

      const etapaAnterior = (lastEtapa?.etapa_destino as string | null) ?? null;

      if ((etapaAnterior ?? null) !== stageNuevo) {
        const etapaPayload: Record<string, unknown> = {
          oportunidad: oportunidadId,
          etapa_origen: etapaAnterior,
          etapa_destino: stageNuevo,
        };

        console.log("[DIG opportunity-updated2] Cambio de etapa detectado. insertPayload historial_etapas =", etapaPayload);

        const { error: heError } = await supabaseAdmin
          .from("historial_etapas")
          .insert(etapaPayload);

        if (heError) {
          console.error("[DIG opportunity-updated2] Error insertando en historial_etapas:", heError);
        } else {
          etapaInserted = true;
        }
      } else {
        console.log("[DIG opportunity-updated2] No inserta historial_etapas: etapa_destino igual a la última.", {
          etapaAnterior,
          stageNuevo,
        });
      }
    }

    return NextResponse.json(
      {
        ok: true,
        updated: true,
        oportunidad_id: oportunidadId,
        pipeline_changed: pipelineChanged,
        reasignacion_creada: reasignacionCreada,
        etapa_inserted: etapaInserted,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[DIG opportunity-updated2] ERROR INESPERADO:", err);
    return NextResponse.json({ ok: false, error: "error interno" }, { status: 500 });
  }
}