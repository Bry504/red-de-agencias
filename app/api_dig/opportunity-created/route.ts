/* eslint-disable @typescript-eslint/no-unused-vars */
import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

// Puedes usar este env o dejar el token fijo si prefieres.
// Ideal: process.env.GHL_WEBHOOK_TOKEN === 'pit-f9...'
const WEBHOOK_TOKEN = process.env.GHL_WEBHOOK_TOKEN ?? 'pit-f995f6e7-c20a-4b1e-8a5e-a18659542bf5';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Faltan variables de entorno de Supabase');
}

const supabaseAdmin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// --------- Helpers de lectura segura ---------

type Dict = Record<string, unknown>;

const isObj = (v: unknown): v is Dict => typeof v === 'object' && v !== null;

const get = (o: unknown, p: string): unknown => {
  if (!isObj(o)) return undefined;
  return p
    .split('.')
    .reduce<unknown>((acc, key) => (isObj(acc) ? (acc as Dict)[key] : undefined), o);
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

// --------- Tipos ---------

interface OportunidadInsert {
  nombre_completo: string | null;
  contacto_id: string | null;
  propietario_id: string | null;
  estado: string | null;
  nivel_de_interes: string | null;
  tipo_de_cliente: string | null;
  producto: string | null;
  proyecto: string | null;
  modalidad_de_pago: string | null;
  motivo_de_seguimiento: string | null;
  principales_objeciones: string | null;
  arras: number | null;
  hl_opportunity_id: string | null;
  pipeline: string | null;
}

// --------- Handler ---------

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token');

    if (token !== WEBHOOK_TOKEN) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const root = (await req.json()) as unknown;

    // 1) Leemos campos directos del payload
    const nombreCompleto = S(root, 'nombre_completo');
    const hlContactId = S(root, 'hl_contact_id');
    const ghlId = S(root, 'ghl_id');

    const estado = S(root, 'estado');
    const nivelDeInteres = S(root, 'nivel_de_interes');
    const tipoDeCliente = S(root, 'tipo_de_cliente');
    const producto = S(root, 'producto');
    const proyecto = S(root, 'proyecto');
    const modalidadDePago = S(root, 'modalidad_de_pago');
    const motivoDeSeguimiento = S(root, 'motivo_de_seguimiento');
    const principalesObjeciones = S(root, 'principales_objeciones');
    const hlOpportunityId = S(root, 'hl_opportunity_id');
    const pipeline = S(root, 'pipeline');

    // arras puede venir como string o número
    const arrasNumFromN = N(root, 'arras');
    const arrasStr = S(root, 'arras');
    let arras: number | null = null;

    if (typeof arrasNumFromN === 'number') {
      arras = arrasNumFromN;
    } else if (arrasStr) {
      const num = Number(arrasStr.replace(/,/g, '.'));
      arras = Number.isNaN(num) ? null : num;
    }

    // 2) Buscamos contacto_id en la tabla contactos por hl_contact_id
    let contactoId: string | null = null;

    if (hlContactId) {
      const { data: contacto, error: contactoError } = await supabaseAdmin
        .from('contactos')
        .select('id')
        .eq('hl_contact_id', hlContactId)
        .maybeSingle();

      if (contactoError && contactoError.code !== 'PGRST116') {
        console.error('[opportunity-created] Error buscando contacto:', contactoError);
      }

      if (contacto && typeof contacto.id === 'string') {
        contactoId = contacto.id;
      }
    }

    // 3) Buscamos propietario_id en la tabla usuarios por ghl_id
    let propietarioId: string | null = null;

    if (ghlId) {
      const { data: usuario, error: usuarioError } = await supabaseAdmin
        .from('usuarios')
        .select('id')
        .eq('ghl_id', ghlId)
        .maybeSingle();

      if (usuarioError && usuarioError.code !== 'PGRST116') {
        console.error('[opportunity-created] Error buscando usuario:', usuarioError);
      }

      if (usuario && typeof usuario.id === 'string') {
        propietarioId = usuario.id;
      }
    }

    // 4) Armamos el objeto para insertar en oportunidades
    const oportunidad: OportunidadInsert = {
      nombre_completo: nombreCompleto ?? null,
      contacto_id: contactoId, // si no encontró contacto queda null
      propietario_id: propietarioId, // si no encontró usuario queda null
      estado: estado ?? null,
      nivel_de_interes: nivelDeInteres ?? null,
      tipo_de_cliente: tipoDeCliente ?? null,
      producto: producto ?? null,
      proyecto: proyecto ?? null,
      modalidad_de_pago: modalidadDePago ?? null,
      motivo_de_seguimiento: motivoDeSeguimiento ?? null,
      principales_objeciones: principalesObjeciones ?? null,
      arras,
      hl_opportunity_id: hlOpportunityId ?? null,
      pipeline: pipeline ?? null,
    };

    // 5) Insertamos la oportunidad
    const { data, error } = await supabaseAdmin
      .from('oportunidades')
      .insert(oportunidad)
      .select('id')
      .single();

    if (error) {
      console.error('[opportunity-created] Error insertando oportunidad:', error);
      return NextResponse.json(
        { ok: false, error: 'Error insertando oportunidad' },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        oportunidad_id: data?.id ?? null,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[opportunity-created] Error inesperado:', err);
    return NextResponse.json({ ok: false, error: 'Error interno' }, { status: 500 });
  }
}