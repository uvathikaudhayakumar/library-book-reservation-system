require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/library_reservation';
const FINE_PER_DAY = Math.max(0, Number(process.env.FINE_PER_DAY || 5));

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const bookSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  author: { type: String, required: true, trim: true },
  isbn: { type: String, default: '', trim: true },
  category: { type: String, default: 'General', trim: true },
  publisher: { type: String, default: '' },
  year: { type: Number, default: new Date().getFullYear() },
  copies: { type: Number, required: true, min: 1, default: 1 },
  shelf: { type: String, default: '' },
  description: { type: String, default: '' }
}, { timestamps: true });
bookSchema.virtual('available').get(function () {
  return Math.max(0, this.copies - (this.issuedCopies || 0));
});
bookSchema.set('toJSON', { virtuals: true });
bookSchema.set('toObject', { virtuals: true });

const memberSchema = new mongoose.Schema({
  memberCode: { type: String, unique: true, sparse: true },
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, default: '' },
  department: { type: String, default: 'General' },
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' }
}, { timestamps: true });

const reservationSchema = new mongoose.Schema({
  bookId: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true },
  memberId: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true },
  reservedAt: { type: Date, default: Date.now },
  status: { type: String, enum: ['Pending', 'Fulfilled', 'Cancelled'], default: 'Pending' }
}, { timestamps: true });

const loanSchema = new mongoose.Schema({
  bookId: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true },
  memberId: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true },
  reservationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Reservation', default: null },
  issuedAt: { type: Date, default: Date.now },
  dueAt: { type: Date, required: true },
  returnedAt: { type: Date, default: null },
  fineAmount: { type: Number, default: 0, min: 0 },
  finePaid: { type: Boolean, default: false }
}, { timestamps: true });

const Book = mongoose.model('Book', bookSchema);
const Member = mongoose.model('Member', memberSchema);
const Reservation = mongoose.model('Reservation', reservationSchema);
const Loan = mongoose.model('Loan', loanSchema);

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const dateOnly = d => new Date(d).toISOString().slice(0, 10);
function daysLate(dueAt, reference = new Date()) {
  const due = new Date(dueAt); due.setHours(0,0,0,0);
  const ref = new Date(reference); ref.setHours(0,0,0,0);
  return Math.max(0, Math.floor((ref - due) / 86400000));
}
function currentFine(loan) {
  return loan.returnedAt ? Number(loan.fineAmount || 0) : daysLate(loan.dueAt) * FINE_PER_DAY;
}
function statusOf(loan) {
  if (loan.returnedAt) return 'Returned';
  return daysLate(loan.dueAt) > 0 ? 'Overdue' : 'Issued';
}
async function loanView(loan) {
  const [book, member] = await Promise.all([
    Book.findById(loan.bookId).lean(), Member.findById(loan.memberId).lean()
  ]);
  return { ...loan.toObject(), book: book?.title || 'Deleted book', member: member?.name || 'Deleted member',
    memberCode: member?.memberCode || '', fineDue: currentFine(loan), status: statusOf(loan) };
}

app.get('/api/health', (req, res) => res.json({
  status: 'ok', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  databaseName: mongoose.connection.name || 'not connected', finePerDay: FINE_PER_DAY
}));

app.get('/api/books', asyncRoute(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const filter = q ? { $or: [
    { title: { $regex: q, $options: 'i' } }, { author: { $regex: q, $options: 'i' } },
    { isbn: { $regex: q, $options: 'i' } }, { category: { $regex: q, $options: 'i' } }
  ] } : {};
  const books = await Book.find(filter).sort({ title: 1 }).lean();
  const result = await Promise.all(books.map(async b => {
    const issuedCopies = await Loan.countDocuments({ bookId: b._id, returnedAt: null });
    return { ...b, available: Math.max(0, b.copies - issuedCopies) };
  }));
  res.json(result);
}));
app.post('/api/books', asyncRoute(async (req, res) => {
  const { title, author, isbn, category, publisher, year, copies, shelf, description } = req.body;
  if (!title?.trim() || !author?.trim()) return res.status(400).json({ error: 'Book title and author are required.' });
  const book = await Book.create({ title, author, isbn, category, publisher, year, copies, shelf, description });
  res.status(201).json(book);
}));
app.put('/api/books/:id', asyncRoute(async (req, res) => {
  const book = await Book.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!book) return res.status(404).json({ error: 'Book not found.' });
  res.json(book);
}));
app.delete('/api/books/:id', asyncRoute(async (req, res) => {
  const active = await Loan.exists({ bookId: req.params.id, returnedAt: null });
  const pending = await Reservation.exists({ bookId: req.params.id, status: 'Pending' });
  if (active || pending) return res.status(409).json({ error: 'This book has an active loan or pending reservation.' });
  const book = await Book.findByIdAndDelete(req.params.id);
  if (!book) return res.status(404).json({ error: 'Book not found.' });
  res.json({ ok: true });
}));

app.get('/api/members', asyncRoute(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const filter = q ? { $or: [
    { name: { $regex: q, $options: 'i' } }, { email: { $regex: q, $options: 'i' } },
    { department: { $regex: q, $options: 'i' } }, { memberCode: { $regex: q, $options: 'i' } }
  ] } : {};
  res.json(await Member.find(filter).sort({ name: 1 }).lean());
}));
app.post('/api/members', asyncRoute(async (req, res) => {
  const { name, email, phone, department } = req.body;
  if (!name?.trim() || !email?.trim()) return res.status(400).json({ error: 'Name and email are required.' });
  const count = await Member.countDocuments();
  const member = await Member.create({ name, email, phone, department, memberCode: `LIB${String(count + 1).padStart(4, '0')}` });
  res.status(201).json(member);
}));
app.put('/api/members/:id', asyncRoute(async (req, res) => {
  const member = await Member.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!member) return res.status(404).json({ error: 'Member not found.' });
  res.json(member);
}));
app.delete('/api/members/:id', asyncRoute(async (req, res) => {
  if (await Loan.exists({ memberId: req.params.id, returnedAt: null })) return res.status(409).json({ error: 'Member has an active loan; return it first.' });
  const member = await Member.findByIdAndDelete(req.params.id);
  if (!member) return res.status(404).json({ error: 'Member not found.' });
  res.json({ ok: true });
}));

app.get('/api/reservations', asyncRoute(async (req, res) => {
  const reservations = await Reservation.find().sort({ reservedAt: -1 }).lean();
  res.json(await Promise.all(reservations.map(async r => {
    const [book, member] = await Promise.all([Book.findById(r.bookId).lean(), Member.findById(r.memberId).lean()]);
    return { ...r, book: book?.title || 'Deleted book', member: member?.name || 'Deleted member', memberCode: member?.memberCode || '' };
  })));
}));
app.post('/api/reservations', asyncRoute(async (req, res) => {
  const { bookId, memberId } = req.body;
  const [book, member] = await Promise.all([Book.findById(bookId), Member.findById(memberId)]);
  if (!book || !member) return res.status(400).json({ error: 'Choose a valid book and member.' });
  if (member.status !== 'Active') return res.status(409).json({ error: 'Member is inactive.' });
  const alreadyPending = await Reservation.exists({ bookId, memberId, status: 'Pending' });
  if (alreadyPending) return res.status(409).json({ error: 'This member already has a pending reservation for this book.' });
  const reservation = await Reservation.create({ bookId, memberId });
  res.status(201).json(reservation);
}));
app.post('/api/reservations/:id/cancel', asyncRoute(async (req, res) => {
  const r = await Reservation.findById(req.params.id);
  if (!r) return res.status(404).json({ error: 'Reservation not found.' });
  if (r.status !== 'Pending') return res.status(409).json({ error: 'Only pending reservations can be cancelled.' });
  r.status = 'Cancelled'; await r.save(); res.json(r);
}));

app.get('/api/loans', asyncRoute(async (req, res) => {
  const loans = await Loan.find().sort({ issuedAt: -1 });
  res.json(await Promise.all(loans.map(loanView)));
}));
app.post('/api/loans', asyncRoute(async (req, res) => {
  const { bookId, memberId, dueAt, reservationId } = req.body;
  const [book, member] = await Promise.all([Book.findById(bookId), Member.findById(memberId)]);
  if (!book || !member) return res.status(400).json({ error: 'Choose a valid book and member.' });
  if (member.status !== 'Active') return res.status(409).json({ error: 'Member is inactive.' });
  const issued = await Loan.countDocuments({ bookId, returnedAt: null });
  if (issued >= book.copies) return res.status(409).json({ error: 'No available copies. Create a reservation instead.' });
  const due = new Date(dueAt);
  if (!dueAt || Number.isNaN(due.getTime()) || due <= new Date()) return res.status(400).json({ error: 'Due date must be in the future.' });
  const loan = await Loan.create({ bookId, memberId, dueAt: due, reservationId: reservationId || null });
  if (reservationId) {
    const r = await Reservation.findById(reservationId);
    if (r && r.status === 'Pending') { r.status = 'Fulfilled'; await r.save(); }
  }
  res.status(201).json(await loanView(loan));
}));
app.post('/api/loans/:id/return', asyncRoute(async (req, res) => {
  const loan = await Loan.findById(req.params.id);
  if (!loan) return res.status(404).json({ error: 'Loan not found.' });
  if (loan.returnedAt) return res.status(409).json({ error: 'This book has already been returned.' });
  loan.returnedAt = new Date();
  loan.fineAmount = daysLate(loan.dueAt, loan.returnedAt) * FINE_PER_DAY;
  await loan.save();
  res.json(await loanView(loan));
}));
app.post('/api/loans/:id/pay-fine', asyncRoute(async (req, res) => {
  const loan = await Loan.findById(req.params.id);
  if (!loan) return res.status(404).json({ error: 'Loan not found.' });
  if (!loan.returnedAt) return res.status(409).json({ error: 'Return the book before marking its fine as paid.' });
  loan.finePaid = true; await loan.save(); res.json(await loanView(loan));
}));

app.get('/api/reports', asyncRoute(async (req, res) => {
  const [books, members, loans, reservations] = await Promise.all([
    Book.find().lean(), Member.find().lean(), Loan.find(), Reservation.find().lean()
  ]);
  const loanViews = await Promise.all(loans.map(loanView));
  const activeLoans = loanViews.filter(l => !l.returnedAt);
  const overdueLoans = activeLoans.filter(l => l.status === 'Overdue');
  const finesOutstanding = loanViews.filter(l => l.fineDue > 0 && !l.finePaid).reduce((s, l) => s + l.fineDue, 0);
  res.json({
    generatedAt: new Date(), totalTitles: books.length, totalCopies: books.reduce((s,b) => s + b.copies, 0),
    members: members.length, activeLoans: activeLoans.length, overdueLoans: overdueLoans.length,
    pendingReservations: reservations.filter(r => r.status === 'Pending').length,
    finesOutstanding, finesCollected: loanViews.filter(l => l.finePaid).reduce((s,l) => s + l.fineAmount, 0),
    finePerDay: FINE_PER_DAY, overdue: overdueLoans.map(l => ({ book: l.book, member: l.member, dueAt: l.dueAt, fineDue: l.fineDue })),
    loans: loanViews
  });
}));
app.get('/api/export', asyncRoute(async (req, res) => {
  const [books, members, reservations, loans] = await Promise.all([
    Book.find().lean(), Member.find().lean(), Reservation.find().lean(), Loan.find().lean()
  ]);
  res.json({ exportedAt: new Date(), books, members, reservations, loans });
}));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === 11000) return res.status(409).json({ error: 'A record with this email or code already exists.' });
  if (err.name === 'ValidationError' || err.name === 'CastError') return res.status(400).json({ error: err.message });
  res.status(500).json({ error: 'Server error. Check the server terminal and MongoDB connection.' });
});

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log(`MongoDB connected: ${mongoose.connection.name}`);
    app.listen(PORT, () => console.log(`Library Book Reservation & Fine Management System running at http://localhost:${PORT}`));
  })
  .catch(err => {
    console.error('Could not connect to MongoDB:', err.message);
    console.error('Start MongoDB and verify MONGODB_URI. Server was not started.');
    process.exit(1);
  });

process.on('SIGINT', async () => { await mongoose.disconnect(); process.exit(0); });
