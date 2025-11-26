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
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function getStringField(
  obj: Record<string, unknown> | null | undefined,
  key: string
): string | null {
  if (!obj) return null;
  const value = obj[key];
  if (typeof value === 'string') {
    const t = value.trim();
    return t === '' ? null : t;
  }
  return null;
}

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
}

// ==============================
// Handler
// ==============================
export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const tokenFromQuery = url.searchParams.get('token');

    console.log('[DIG opportunity-won] token query =', tokenFromQuery);

    if (!WEBHOOK_TOKEN || tokenFromQuery !== WEBHOOK_TOKEN) {
      console.warn('[DIG opportunity-won] Token inválido.');
      return NextResponse.json(
        { ok: false, error: 'unauthorized' },
        { status: 401 }
      );
    }

    // Leer body
    const rawBody: unknown = await req.json().catch(() => null);
    if (!isRecord(rawBody)) {
      console.error('[DIG opportunity-won] Body no es objeto:', rawBody);
      return NextResponse.json(
        { ok: false, error: 'invalid_payload' },
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

    console.log('[DIG opportunity-won] root:', JSON.stringify(root, null, 2));
    console.log('[DIG opportunity-won] customData:', JSON.stringify(customData, null, 2));

    // Resolver hl_opportunity_id
    let hlOpportunityId =
      getStringField(customData, 'oportunidad') ??
      getStringField(root, 'oportunidad') ??
      getStringField(opportunityObj, 'id') ??
      getStringField(root, 'hl_opportunity_id');

    const cleaned: OpportunityWonClean = {
      hl_opportunity_id: hlOpportunityId,
      propietario_ghl_id:
        getStringField(customData, 'propietario') ??
        getStringField(root, 'propietario'),
      pipeline_text:
        getStringField(customData, 'pipeline') ??
        getStringField(root, 'pipeline'),
      arras_str:
        getStringField(customData, 'arras') ??
        getStringField(root, 'arras'),
    };

    console.log('[DIG opportunity-won] Campos limpios:', cleaned);

    if (!cleaned.hl_opportunity_id) {
      console.warn('[DIG opportunity-won] Falta hl_opportunity_id.');
      return NextResponse.json(
        { ok: false, error: 'missing_hl_opportunity_id' },
        { status: 400 }
      );
    }

    // Buscar oportunidad local
    const { data: oppRow, error: oppErr } = await supabase
      .from('oportunidades')
      .select('id')
      .eq('hl_opportunity_id', cleaned.hl_opportunity_id)
      .maybeSingle();

    if (oppErr) {
      console.error('[DIG opportunity-won] Error buscando oportunidad:', oppErr);
      return NextResponse.json(
        { ok: false, error: 'supabase_error', details: oppErr.message },
        { status: 500 }
      );
    }

    if (!oppRow) {
      console.warn('[DIG opportunity-won] SKIP: no se encontró oportunidad.');
      return NextResponse.json(
        { ok: true, skipped: true, reason: 'opportunity_not_found' },
        { status: 200 }
      );
    }

    const oportunidadId = oppRow.id as string;

    // Buscar propietario
    let propietarioId: string | null = null;

    if (cleaned.propietario_ghl_id) {
      const { data: usuarioRow, error: usuarioErr } = await supabase
        .from('usuarios')
        .select('id')
        .eq('ghl_id', cleaned.propietario_ghl_id)
        .maybeSingle();

      if (usuarioErr) {
        console.error('[DIG opportunity-won] Error usuario:', usuarioErr);
      } else if (usuarioRow?.id) {
        propietarioId = usuarioRow.id as string;
      } else {
        console.warn('[DIG opportunity-won] No se encontró propietario con ese ghl_id.');
      }
    }

    // Parsear arras
    const arras = toNumberOrNull(cleaned.arras_str);

    // Insert final
    const insertPayload = {
      oportunidad: oportunidadId,
      propietario: propietarioId,
      pipeline: cleaned.pipeline_text,
      arras,
      cuota_inicial_pagada: null, // ❗ NO se envía desde canal digital
    };

    console.log('[DIG opportunity-won] insertPayload op_ganadas =', insertPayload);

    const { data: inserted, error: insertError } = await supabase
      .from('op_ganadas')
      .insert(insertPayload)
      .select('id')
      .single();

    if (insertError) {
      console.error('[DIG opportunity-won] Error insertando:', insertError);
      return NextResponse.json(
        { ok: false, error: 'supabase_error', details: insertError.message },
        { status: 500 }
      );
    }

    console.log('[DIG opportunity-won] Insert OK id =', inserted?.id ?? null);

    return NextResponse.json(
      { ok: true, inserted: true, id: inserted?.id ?? null },
      { status: 201 }
    );

  } catch (err) {
    console.error('[DIG opportunity-won] Error inesperado:', err);
    return NextResponse.json(
      { ok: false, error: 'unexpected_error' },
      { status: 500 }
    );
  }
}