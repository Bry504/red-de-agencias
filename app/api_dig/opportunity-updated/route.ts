/* eslint-disable @typescript-eslint/no-unused-vars */
import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

const WEBHOOK_TOKEN =
  process.env.GHL_WEBHOOK_TOKEN ?? 'pit-f995f6e7-c20a-4b1e-8a5e-a18659542bf5';

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

interface OportunidadUpdatePayload {
  nombre_completo?: string | null;
  contacto_id?: string | null;
  propietario_id?: string | null;
  estado?: string | null;
  nivel_de_interes?: string | null;
  tipo_de_cliente?: string | null;
  producto?: string | null;
  proyecto?: string | null;
  modalidad_de_pago?: string | null;
  motivo_de_seguimiento?: string | null;
  principales_objeciones?: string | null;
  arras?: number | null;
  pipeline?: string | null;
  // NOTA: no vamos a cambiar hl_opportunity_id aquí,
  // porque es la clave de búsqueda. Lo dejamos fuera.
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

    // 1) Campos base del payload
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

    if (!hlOpportunityId) {
      // Sin hl_opportunity_id no sabemos qué fila actualizar.
      return NextResponse.json(
        { ok: false, error: 'Falta hl_opportunity_id en el payload' },
        { status: 400 },
      );
    }

    // 2) Verificamos si existe la oportunidad a actualizar
    const { data: oportunidadExistente, error: findError } = await supabaseAdmin
      .from('oportunidades')
      .select('id')
      .eq('hl_opportunity_id', hlOpportunityId)
      .maybeSingle();

    if (findError && findError.code !== 'PGRST116') {
      console.error('[opportunity-updated] Error buscando oportunidad:', findError);
      return NextResponse.json(
        { ok: false, error: 'Error al buscar oportunidad' },
        { status: 500 },
      );
    }

    if (!oportunidadExistente) {
      // No existe oportunidad con ese hl_opportunity_id -> no hacemos nada
      return NextResponse.json(
        {
          ok: true,
          updated: false,
          message: 'No se encontró oportunidad para este hl_opportunity_id. No se realizó ninguna acción.',
        },
        { status: 200 },
      );
    }

    // 3) Buscamos contacto_id en la tabla contactos por hl_contact_id
    let contactoId: string | null | undefined = undefined;

    if (hlContactId) {
      const { data: contacto, error: contactoError } = await supabaseAdmin
        .from('contactos')
        .select('id')
        .eq('hl_contact_id', hlContactId)
        .maybeSingle();

      if (contactoError && contactoError.code !== 'PGRST116') {
        console.error('[opportunity-updated] Error buscando contacto:', contactoError);
      }

      if (contacto && typeof contacto.id === 'string') {
        contactoId = contacto.id;
      } else {
        // Si no encontró contacto para ese hl_contact_id, lo seteamos explícitamente a null
        contactoId = null;
      }
    }

    // 4) Buscamos propietario_id en la tabla usuarios por ghl_id
    let propietarioId: string | null | undefined = undefined;

    if (ghlId) {
      const { data: usuario, error: usuarioError } = await supabaseAdmin
        .from('usuarios')
        .select('id')
        .eq('ghl_id', ghlId)
        .maybeSingle();

      if (usuarioError && usuarioError.code !== 'PGRST116') {
        console.error('[opportunity-updated] Error buscando usuario:', usuarioError);
      }

      if (usuario && typeof usuario.id === 'string') {
        propietarioId = usuario.id;
      } else {
        // Si no se encuentra usuario para ese ghl_id, lo seteamos a null
        propietarioId = null;
      }
    }

    // 5) Armamos el objeto de actualización.
    // Solo incluimos campos definidos, para no sobreescribir con undefined.
    const updatePayload: OportunidadUpdatePayload = {};

    if (typeof nombreCompleto !== 'undefined') {
      updatePayload.nombre_completo = nombreCompleto ?? null;
    }
    if (typeof contactoId !== 'undefined') {
      updatePayload.contacto_id = contactoId;
    }
    if (typeof propietarioId !== 'undefined') {
      updatePayload.propietario_id = propietarioId;
    }
    if (typeof estado !== 'undefined') {
      updatePayload.estado = estado ?? null;
    }
    if (typeof nivelDeInteres !== 'undefined') {
      updatePayload.nivel_de_interes = nivelDeInteres ?? null;
    }
    if (typeof tipoDeCliente !== 'undefined') {
      updatePayload.tipo_de_cliente = tipoDeCliente ?? null;
    }
    if (typeof producto !== 'undefined') {
      updatePayload.producto = producto ?? null;
    }
    if (typeof proyecto !== 'undefined') {
      updatePayload.proyecto = proyecto ?? null;
    }
    if (typeof modalidadDePago !== 'undefined') {
      updatePayload.modalidad_de_pago = modalidadDePago ?? null;
    }
    if (typeof motivoDeSeguimiento !== 'undefined') {
      updatePayload.motivo_de_seguimiento = motivoDeSeguimiento ?? null;
    }
    if (typeof principalesObjeciones !== 'undefined') {
      updatePayload.principales_objeciones = principalesObjeciones ?? null;
    }
    if (typeof arras !== 'undefined') {
      updatePayload.arras = arras;
    }
    if (typeof pipeline !== 'undefined') {
      updatePayload.pipeline = pipeline ?? null;
    }

    // 6) Ejecutamos el update
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('oportunidades')
      .update(updatePayload)
      .eq('hl_opportunity_id', hlOpportunityId)
      .select('id')
      .maybeSingle();

    if (updateError) {
      console.error('[opportunity-updated] Error actualizando oportunidad:', updateError);
      return NextResponse.json(
        { ok: false, error: 'Error actualizando oportunidad' },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        updated: true,
        oportunidad_id: updated?.id ?? null,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[opportunity-updated] Error inesperado:', err);
    return NextResponse.json({ ok: false, error: 'Error interno' }, { status: 500 });
  }
}