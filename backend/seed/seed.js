/**
 * Script de datos iniciales: ciudades principales de Colombia,
 * categorias comunes de objetos, un usuario administrador y una
 * institucion de ejemplo (UTS).
 *
 * Ejecutar con: npm run seed
 */
const dotenv = require('dotenv');
dotenv.config();
const connectDB = require('../config/db');
const City = require('../models/City');
const Category = require('../models/Category');
const User = require('../models/User');
const Institution = require('../models/Institution');
const colombiaData = require('./colombiaData');

// Convierte la lista agrupada por departamento en una lista plana
// { name, department } que es lo que espera el modelo City.
const cities = colombiaData.flatMap((dep) =>
  dep.cities.map((cityName) => ({ name: cityName, department: dep.department }))
);

const categories = [
  { name: 'Documentos', icon: 'bi-file-earmark-text' },
  { name: 'Celulares y tecnología', icon: 'bi-phone' },
  { name: 'Billeteras y dinero', icon: 'bi-wallet2' },
  { name: 'Llaves', icon: 'bi-key' },
  { name: 'Mochilas y bolsos', icon: 'bi-bag' },
  { name: 'Gafas', icon: 'bi-eyeglasses' },
  { name: 'Ropa y accesorios', icon: 'bi-person-badge' },
  { name: 'Mascotas', icon: 'bi-heart' },
  { name: 'Otros', icon: 'bi-box-seam' },
];

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

  console.log('Sembrando categorias...');
  for (const c of categories) {
    await Category.findOneAndUpdate({ name: c.name }, c, { upsert: true, new: true });
  }

  console.log('Creando usuario administrador...');
  let admin = await User.findOne({ email: 'admin@objetosperdidos.co' });
  if (!admin) {
    admin = await User.create({
      name: 'Administrador General',
      email: 'admin@objetosperdidos.co',
      password: 'Admin1234',
      role: 'admin',
      city: cityDocs['Bucaramanga']._id,
    });
    console.log('   -> admin@objetosperdidos.co / Admin1234');
  }

  console.log('Creando institucion de ejemplo (UTS)...');
  let institutionUser = await User.findOne({ email: 'uts@objetosperdidos.co' });
  if (!institutionUser) {
    institutionUser = await User.create({
      name: 'UTS - Objetos Perdidos',
      email: 'uts@objetosperdidos.co',
      password: 'Uts12345',
      role: 'institucion',
      city: cityDocs['Bucaramanga']._id,
    });
    console.log('   -> uts@objetosperdidos.co / Uts12345');
  }

  let institution = await Institution.findOne({ name: 'UTS - Sede Bucaramanga' });
  if (!institution) {
    institution = await Institution.create({
      name: 'UTS - Sede Bucaramanga',
      type: 'universidad',
      city: cityDocs['Bucaramanga']._id,
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
