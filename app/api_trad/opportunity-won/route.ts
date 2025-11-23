/* eslint-disable */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// ==============================
// Supabase
// ==============================
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// ==============================
// Token
// ==============================
const WEBHOOK_TOKEN =
  process.env.GHL_WEBHOOK_TOKEN ??
  process.env.GHL_API_KEY ??
  '';

// ==============================
// Helpers
// ==============================
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getStringField(
  obj: Record<string, unknown> | null | undefined,
  key: string
): string | null {
  if (!obj) return null;
  const v = obj[key];
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? null : t;
  }
  return null;
}

// ⭐⭐⭐ Nueva función correcta:
function toNumberOrNull(v: string | null): number | null {
  if (!v) return null;

  const cleaned = v.replace(/[^\d,.\-]/g, '');
  const normalized = cleaned.replace(/,/g, '');

  const num = parseFloat(normalized);
  return Number.isNaN(num) ? null : num;
}

interface OpportunityWonClean {
  hl_opportunity_id: string | null;
  propietario_ghl_id: string | null;
  pipeline_text: string | null;
  arras_str: string | null;
  cuota_inicial_str: string | null;
}

// ==============================
// Handler
// ==============================
export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const tokenFromQuery = url.searchParams.get('token');

    if (!WEBHOOK_TOKEN || tokenFromQuery !== WEBHOOK_TOKEN) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const rawBody: unknown = await req.json().catch(() => null);
    if (!isRecord(rawBody)) {
      return NextResponse.json(
        { ok: false, error: 'Invalid payload' },
        { status: 400 }
      );
    }

    const root = rawBody;

    let opportunityObj: Record<string, unknown> = {};
    if ('opportunity' in root && isRecord(root['opportunity'])) {
      opportunityObj = root['opportunity'] as Record<string, unknown>;
    }

    let customData: Record<string, unknown> = {};
    if ('customData' in root && isRecord(root['customData'])) {
      customData = root['customData'] as Record<string, unknown>;
    }

    let hlOpportunityId =
      getStringField(customData, 'oportunidad') ??
      getStringField(root, 'oportunidad');

    if (!hlOpportunityId) {
      hlOpportunityId =
        getStringField(opportunityObj, 'id') ??
        getStringField(root, 'hl_opportunity_id');
    }

    const cleaned: OpportunityWonClean = {
      hl_opportunity_id: hlOpportunityId ?? null,
      propietario_ghl_id:
        getStringField(customData, 'propietario') ??
        getStringField(root, 'propietario'),
      pipeline_text:
        getStringField(customData, 'pipeline') ??
        getStringField(root, 'pipeline'),
      arras_str:
        getStringField(customData, 'arras') ??
        getStringField(root, 'arras'),
      cuota_inicial_str:
        getStringField(customData, 'cuota_inicial_pagada') ??
        getStringField(root, 'cuota_inicial_pagada'),
    };

    if (!cleaned.hl_opportunity_id) {
      return NextResponse.json(
        { ok: false, error: 'Missing hl_opportunity_id' },
        { status: 400 }
      );
    }

    // Buscar oportunidad
    const { data: oppRow } = await supabase
      .from('oportunidades')
      .select('id')
      .eq('hl_opportunity_id', cleaned.hl_opportunity_id)
      .maybeSingle();

    if (!oppRow) {
      return NextResponse.json(
        { ok: true, inserted: false, reason: 'not_found' },
        { status: 200 }
      );
    }

    const oportunidadId = oppRow.id as string;

    // Buscar propietario
    let propietarioId: string | null = null;

    if (cleaned.propietario_ghl_id) {
      const { data: usuarioRow } = await supabase
        .from('usuarios')
        .select('id')
        .eq('ghl_id', cleaned.propietario_ghl_id)
        .maybeSingle();

      if (usuarioRow?.id) propietarioId = usuarioRow.id as string;
    }

    // ⭐⭐⭐ Parseo final correcto:
    const arras = toNumberOrNull(cleaned.arras_str);
    const cuota_inicial_pagada = toNumberOrNull(cleaned.cuota_inicial_str);

    const insertPayload = {
      oportunidad: oportunidadId,
      propietario: propietarioId,
      pipeline: cleaned.pipeline_text,
      arras,
      cuota_inicial_pagada,
    };

    const { data: inserted, error: insertError } = await supabase
      .from('op_ganadas')
      .insert(insertPayload)
      .select('id')
      .single();

    if (insertError) {
      return NextResponse.json(
        { ok: false, error: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { ok: true, inserted: true, id: inserted?.id },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'unexpected_error', details: String(err) },
      { status: 500 }
    );
  }
}