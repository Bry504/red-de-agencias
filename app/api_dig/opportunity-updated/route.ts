/* eslint-disable @typescript-eslint/no-unused-vars */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

const WEBHOOK_TOKEN =
  process.env.GHL_WEBHOOK_TOKEN ?? 'pit-f995f6e7-c20a-4b1e-8a5e-a18659542bf5';

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Helpers seguros
type Dict = Record<string, unknown>;

const isObj = (v: unknown): v is Dict => typeof v === 'object' && v !== null;

const get = (o: unknown, p: string): unknown => {
  if (!isObj(o)) return undefined;

  return p.split('.').reduce<unknown>((acc, key) => {
    if (!isObj(acc)) return undefined;
    return (acc as Dict)[key];
  }, o);
};

const S = (o: unknown, p: string): string | undefined => {
  const v = get(o, p);
  if (typeof v === 'string') {
    const t = v.trim();
    return t ? t : undefined;
  }
  return undefined;
};

const N = (o: unknown, p: string): number | undefined => {
  const v = get(o, p);
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t) return undefined;
    const num = Number(t.replace(/,/g, '.'));
    return Number.isNaN(num) ? undefined : num;
  }
  return undefined;
};

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token');

    if (token !== WEBHOOK_TOKEN) {
      console.error("[opportunity-updated] TOKEN INVALIDO", token);
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // Lee el JSON completo y lo logea
    const root = (await req.json()) as unknown;
    console.log("[opportunity-updated] Payload recibido:", JSON.stringify(root, null, 2));

    // Extrae campos
    const hlOpportunityId = S(root, "hl_opportunity_id");
    console.log("[opportunity-updated] hl_opportunity_id extraído:", hlOpportunityId);

    if (!hlOpportunityId) {
      console.error("[opportunity-updated] ERROR: No se envió hl_opportunity_id");
      return NextResponse.json(
        {
          ok: false,
          error: "Falta hl_opportunity_id en el payload",
          detalle: "El webhook fue recibido, pero sin ID de oportunidad",
        },
        { status: 400 }
      );
    }

    // Verifica existencia de oportunidad
    const { data: opExistente, error: findError } = await supabaseAdmin
      .from("oportunidades")
      .select("id")
      .eq("hl_opportunity_id", hlOpportunityId)
      .maybeSingle();

    console.log("[opportunity-updated] Resultado búsqueda oportunidad:", {
      oportunidad_id: opExistente?.id || null,
      error: findError || null,
    });

    if (findError && findError.code !== "PGRST116") {
      console.error("[opportunity-updated] Error buscando oportunidad:", findError);
      return NextResponse.json({ ok: false, error: "Error buscando oportunidad" }, { status: 500 });
    }

    if (!opExistente) {
      console.warn("[opportunity-updated] No existe oportunidad, no se actualiza nada");
      return NextResponse.json(
        {
          ok: true,
          updated: false,
          message: "No existe una oportunidad con ese hl_opportunity_id",
        },
        { status: 200 }
      );
    }

    // Extrae el resto de campos
    const updatePayload: Record<string, unknown> = {
      nombre_completo: S(root, "nombre_completo") ?? null,
      estado: S(root, "estado") ?? null,
      nivel_de_interes: S(root, "nivel_de_interes") ?? null,
      tipo_de_cliente: S(root, "tipo_de_cliente") ?? null,
      producto: S(root, "producto") ?? null,
      proyecto: S(root, "proyecto") ?? null,
      modalidad_de_pago: S(root, "modalidad_de_pago") ?? null,
      motivo_de_seguimiento: S(root, "motivo_de_seguimiento") ?? null,
      principales_objeciones: S(root, "principales_objeciones") ?? null,
      pipeline: S(root, "pipeline") ?? null,
    };

    // arras
    const arrasNum = N(root, "arras");
    updatePayload.arras = typeof arrasNum === "number" ? arrasNum : null;

    console.log("[opportunity-updated] Campos base antes de lookup:", updatePayload);

    // Lookup: contacto_id
    const hlContactId = S(root, "hl_contact_id");
    if (hlContactId) {
      const { data: contacto } = await supabaseAdmin
        .from("contactos")
        .select("id")
        .eq("hl_contact_id", hlContactId)
        .maybeSingle();

      updatePayload.contacto_id = contacto?.id ?? null;
      console.log("[opportunity-updated] contacto_id encontrado:", updatePayload.contacto_id);
    }

    // Lookup: propietario_id
    const ghlId = S(root, "ghl_id");
    if (ghlId) {
      const { data: usuario } = await supabaseAdmin
        .from("usuarios")
        .select("id")
        .eq("ghl_id", ghlId)
        .maybeSingle();

      updatePayload.propietario_id = usuario?.id ?? null;
      console.log("[opportunity-updated] propietario_id encontrado:", updatePayload.propietario_id);
    }

    console.log("[opportunity-updated] Payload FINAL para actualizar:", updatePayload);

    // Update final
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("oportunidades")
      .update(updatePayload)
      .eq("hl_opportunity_id", hlOpportunityId)
      .select("id")
      .maybeSingle();

    if (updateError) {
      console.error("[opportunity-updated] ERROR actualizando oportunidad:", updateError);
      return NextResponse.json({ ok: false, error: "Error actualizando oportunidad" }, { status: 500 });
    }

    console.log("[opportunity-updated] UPDATE OK:", updated?.id);

    return NextResponse.json(
      {
        ok: true,
        updated: true,
        oportunidad_id: updated?.id || null,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[opportunity-updated] ERROR INESPERADO:", err);
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}