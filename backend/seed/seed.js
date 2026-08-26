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

  console.log('Sembrando ciudades...');
  // BUG CORREGIDO: el filtro del upsert usaba solo { name: c.name }. Colombia
  // tiene muchos municipios que se llaman igual en departamentos distintos
  // (ej. "Granada" existe en Antioquia, Cundinamarca y Meta; "Belén", "Concordia",
  // "La Union", "San Luis", etc. tambien se repiten). Con el filtro anterior,
  // el segundo municipio con el mismo nombre encontraba el documento del primero
  // y le SOBRESCRIBIA el departamento, en vez de crear un municipio nuevo -
  // el indice unico real del modelo City es (name + department), asi que el
  // filtro del seed debe usar ambos campos para que cada combinacion quede
  // como su propio documento.
  const cityDocs = {};
  for (const c of cities) {
    const doc = await City.findOneAndUpdate(
      { name: c.name, department: c.department },
      c,
      { upsert: true, new: true }
    );
    cityDocs[c.name] = doc;
    cityDocs[`${c.name}|${c.department}`] = doc;
  }

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
