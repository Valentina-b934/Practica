const asyncHandler = require('express-async-handler');
const City = require('../models/City');
const { cleanString, isValidObjectId } = require('../utils/validators');

// Solo campos conocidos (evita que se envien campos arbitrarios al modelo)
function pickCityFields(body) {
  const data = {};
  if (body.name !== undefined) data.name = cleanString(body.name, 80);
  if (body.department !== undefined) data.department = cleanString(body.department, 80);
  if (typeof body.active === 'boolean') data.active = body.active;
  return data;
}

const listCities = asyncHandler(async (req, res) => {
  const cities = await City.find({ active: true }).sort('name');
  res.json(cities);
});

const createCity = asyncHandler(async (req, res) => {
  const city = await City.create(pickCityFields(req.body));
  res.status(201).json(city);
});

const updateCity = asyncHandler(async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    res.status(404);
    throw new Error('Ciudad no encontrada');
  }
  const city = await City.findByIdAndUpdate(req.params.id, pickCityFields(req.body), { new: true, runValidators: true });
  res.json(city);
});

const deleteCity = asyncHandler(async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    res.status(404);
    throw new Error('Ciudad no encontrada');
  }
  await City.findByIdAndUpdate(req.params.id, { active: false });
  res.json({ message: 'Ciudad desactivada' });
});

module.exports = { listCities, createCity, updateCity, deleteCity };