/**
 * Script de datos iniciales: municipios de Colombia, las 5 categorias
 * oficiales de objetos, un usuario administrador y una institucion de
 * ejemplo (UTS).
 *
 * Ejecutar con: npm run seed
 *
 * Credenciales iniciales: se toman de SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
 * y SEED_INSTITUTION_EMAIL / SEED_INSTITUTION_PASSWORD. Como el inicio de
 * sesion ahora pide un codigo OTP por correo, el correo del administrador
 * debe ser un buzon REAL al que tengas acceso. En produccion estas
 * variables son obligatorias (no se usan contraseñas de demostracion).
 */
const dotenv = require('dotenv');
dotenv.config();
const connectDB = require('../config/db');
const City = require('../models/City');
const User = require('../models/User');
const Institution = require('../models/Institution');
const colombiaData = require('./colombiaData');
const { migrateCategories } = require('./migrateCategories');
const { validatePasswordPolicy } = require('../utils/validators');

const isProduction = process.env.NODE_ENV === 'production';

function seedCredential(emailVar, passVar, demoEmail, demoPass) {
  const email = process.env[emailVar] || (isProduction ? null : demoEmail);
  const password = process.env[passVar] || (isProduction ? null : demoPass);
  if (!email || !password) {
    throw new Error(`Define ${emailVar} y ${passVar} en el entorno para ejecutar el seed en produccion.`);
  }
  const policyError = validatePasswordPolicy(password);
  if (policyError) throw new Error(`${passVar}: ${policyError}`);
  return { email: email.toLowerCase().trim(), password };
}

// Convierte la lista agrupada por departamento en una lista plana
// { name, department } que es lo que espera el modelo City.
const cities = colombiaData.flatMap((dep) =>
  dep.cities.map((cityName) => ({ name: cityName, department: dep.department }))
);

async function run() {
  await connectDB();

  console.log(`Sembrando ${cities.length} ciudades/municipios de los 32 departamentos + Bogotá D.C....`);
  // BUG CORREGIDO: antes se indexaba `cityDocs` solo por `name`, pero
  // Colombia tiene muchos municipios que se llaman igual en departamentos
  // distintos (ej. "La Unión" existe en Valle del Cauca, Nariño, Antioquia
  // y Cundinamarca). Con la lista completa de +1100 municipios esas
  // colisiones de nombre son frecuentes: el registro de un departamento
  // sobreescribía en el cache al de otro con el mismo nombre. Ahora se
  // indexa por "nombre|departamento", que sí es único (coincide con el
  // índice compuesto único del modelo City).
  const cityDocs = {};
  for (const c of cities) {
    const doc = await City.findOneAndUpdate(
      { name: c.name, department: c.department },
      c,
      { upsert: true, new: true }
    );
    cityDocs[`${c.name}|${c.department}`] = doc;
  }
  const bucaramanga = cityDocs['Bucaramanga|Santander'];

  console.log('Sembrando categorias oficiales (Billeteras, Gafas, Carteras, Documentos, Dispositivos)...');
  await migrateCategories();

  const adminCred = seedCredential('SEED_ADMIN_EMAIL', 'SEED_ADMIN_PASSWORD', 'admin@objetosperdidos.co', 'Admin1234');
  const instCred = seedCredential('SEED_INSTITUTION_EMAIL', 'SEED_INSTITUTION_PASSWORD', 'uts@objetosperdidos.co', 'Uts12345');

  console.log('Creando usuario administrador...');
  // BUG CORREGIDO: antes se usaba cityDocs['Bucaramanga'], pero el cache
  // se indexa por "nombre|departamento", asi que esa clave no existia y en
  // una base vacia el seed fallaba con "Cannot read properties of undefined".
  let admin = await User.findOne({ email: adminCred.email });
  if (!admin) {
    admin = await User.create({
      name: 'Administrador General',
      email: adminCred.email,
      password: adminCred.password,
      role: 'admin',
      emailVerified: true,
      city: bucaramanga._id,
    });
    console.log(`   -> ${adminCred.email}${isProduction ? '' : ` / ${adminCred.password}`}`);
  }

  console.log('Creando institucion de ejemplo (UTS)...');
  let institutionUser = await User.findOne({ email: instCred.email });
  if (!institutionUser) {
    institutionUser = await User.create({
      name: 'UTS - Objetos Perdidos',
      email: instCred.email,
      password: instCred.password,
      role: 'institucion',
      emailVerified: true,
      city: bucaramanga._id,
    });
    console.log(`   -> ${instCred.email}${isProduction ? '' : ` / ${instCred.password}`}`);
  }

  let institution = await Institution.findOne({ name: 'UTS - Sede Bucaramanga' });
  if (!institution) {
    institution = await Institution.create({
      name: 'UTS - Sede Bucaramanga',
      type: 'universidad',
      city: bucaramanga._id,
      address: 'Cra 27 Calle 9, Bucaramanga',
      contactEmail: 'objetosperdidos@uts.edu.co',
      adminUser: institutionUser._id,
    });
    institutionUser.institution = institution._id;
    await institutionUser.save();
  }

  console.log('✅ Datos iniciales creados con exito.');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});