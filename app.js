const appState = { page: 'dashboard', books: [], members: [], reservations: [], loans: [], editing: null, type: null };
const modal = () => bootstrap.Modal.getOrCreateInstance(document.getElementById('recordModal'));
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => '₹' + Number(n || 0).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2});
const dateFmt = v => v ? new Date(v).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—';
const dateInput = d => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`; };
async function api(url, options={}) {
  const response = await fetch('/api'+url, { ...options, headers: {'Content-Type':'application/json', ...(options.headers||{})} });
  let data={}; try { data=await response.json(); } catch {}
  if(!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
function notify(message, danger=false) {
  $('#alertArea').html(`<div class="alert ${danger?'alert-danger':'alert-success'} alert-dismissible fade show" role="alert">${esc(message)}<button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>`);
  window.scrollTo({top:0,behavior:'smooth'});
}
function emptyRow(cols, message='No records found.') { return `<tr><td class="empty-cell" colspan="${cols}">${message}</td></tr>`; }
function badge(status) { const cls = String(status||'').toLowerCase().replace(/\s+/g,'-'); return `<span class="badge-status s-${esc(cls)}">${esc(status||'—')}</span>`; }
function page(name) {
  appState.page=name;
  $('.page').removeClass('active'); $('#page-'+name).addClass('active');
  $('[data-page]').removeClass('active'); $(`[data-page="${name}"]`).addClass('active');
  const titles={dashboard:'Dashboard overview',books:'Book catalogue',members:'Library members',reservations:'Book reservations',loans:'Issue / return & fines',reports:'Admin reports'};
  $('#pageTitle').text(titles[name]||'Library Desk');
  $('.navbar-collapse').collapse('hide');
}
async function refresh() {
  try {
    const [books,members,reservations,loans,health] = await Promise.all([
      api('/books'),api('/members'),api('/reservations'),api('/loans'),api('/health')
    ]);
    Object.assign(appState,{books,members,reservations,loans});
    $('#connection').removeClass('text-bg-secondary text-bg-danger').addClass(health.database==='connected'?'text-bg-success':'text-bg-danger').text('MongoDB '+health.database);
    $('.fine-rate').text(health.finePerDay);
    renderBooks(); renderMembers(); renderReservations(); renderLoans(); fillSelects(); renderDashboard();
    if(appState.page==='reports') renderReports();
  } catch(e) { $('#connection').removeClass('text-bg-secondary text-bg-success').addClass('text-bg-danger').text('API unavailable'); notify(e.message,true); }
}
function renderDashboard() {
  const active=appState.loans.filter(l=>!l.returnedAt), overdue=active.filter(l=>l.status==='Overdue');
  const outstanding=appState.loans.filter(l=>!l.finePaid).reduce((s,l)=>s+Number(l.fineDue||0),0);
  const stats=[['Book titles',appState.books.length,'Catalogue records'],['Active members',appState.members.filter(m=>m.status==='Active').length,'Registered readers'],['Books on loan',active.length,'Currently issued'],['Overdue books',overdue.length,'Require attention'],['Pending reservations',appState.reservations.filter(r=>r.status==='Pending').length,'Waiting to be fulfilled'],['Outstanding fines',money(outstanding),'Unpaid calculated fines']];
  $('#dashboardStats').html(stats.map(s=>`<div class="col-6 col-xl-2 col-md-4"><div class="stat-card h-100"><div class="stat-label">${s[0]}</div><div class="stat-value">${s[1]}</div><div class="stat-hint">${s[2]}</div></div></div>`).join(''));
  $('#recentLoans').html(appState.loans.slice(0,6).map(l=>`<tr><td><span class="book-title">${esc(l.book)}</span></td><td>${esc(l.member)}</td><td>${dateFmt(l.dueAt)}</td><td>${badge(l.status)}</td><td>${money(l.fineDue)}</td></tr>`).join('')||emptyRow(5,'No loans yet.'));
}
function renderBooks() {
  const q=($('#bookSearch').val()||'').toLowerCase();
  const rows=appState.books.filter(b=>[b.title,b.author,b.isbn,b.category].some(v=>String(v||'').toLowerCase().includes(q)));
  $('#booksTable').html(rows.map(b=>`<tr><td><div class="book-title">${esc(b.title)}</div><div class="muted">${esc(b.publisher||'')} ${b.year?'· '+esc(b.year):''}</div></td><td>${esc(b.author)}</td><td>${esc(b.category||'General')}</td><td>${esc(b.isbn||'—')}</td><td><strong>${b.available ?? 0}</strong> / ${b.copies}</td><td>${esc(b.shelf||'—')}</td><td><button class="btn btn-sm btn-outline-primary action-btn" data-edit="book" data-id="${b._id}">Edit</button><button class="btn btn-sm btn-outline-danger action-btn" data-delete="book" data-id="${b._id}">Delete</button><button class="btn btn-sm btn-outline-success action-btn" data-reserve-book="${b._id}">Reserve</button></td></tr>`).join('')||emptyRow(7,'No matching books. Add a book or change your search.'));
}
function renderMembers() {
  const q=($('#memberSearch').val()||'').toLowerCase();
  const rows=appState.members.filter(m=>[m.name,m.email,m.memberCode,m.department].some(v=>String(v||'').toLowerCase().includes(q)));
  $('#membersTable').html(rows.map(m=>`<tr><td><div class="book-title">${esc(m.name)}</div><div class="muted">${esc(m.email)}</div></td><td>${esc(m.memberCode||'—')}</td><td>${esc(m.department||'General')}</td><td>${esc(m.phone||'—')}</td><td>${badge(m.status)}</td><td><button class="btn btn-sm btn-outline-primary action-btn" data-edit="member" data-id="${m._id}">Edit</button><button class="btn btn-sm btn-outline-danger action-btn" data-delete="member" data-id="${m._id}">Delete</button></td></tr>`).join('')||emptyRow(6,'No members found.'));
}
function renderReservations() {
  $('#reservationsTable').html(appState.reservations.map(r=>`<tr><td>${esc(r.book)}</td><td>${esc(r.member)} <span class="muted">${esc(r.memberCode)}</span></td><td>${dateFmt(r.reservedAt)}</td><td>${badge(r.status)}</td><td>${r.status==='Pending'?`<button class="btn btn-sm btn-outline-primary action-btn" data-fulfill="${r._id}">Issue this book</button><button class="btn btn-sm btn-outline-danger action-btn" data-cancel-res="${r._id}">Cancel</button>`:'—'}</td></tr>`).join('')||emptyRow(5,'No reservations yet.'));
}
function renderLoans() {
  $('#loansTable').html(appState.loans.map(l=>`<tr><td><div class="book-title">${esc(l.book)}</div><div class="muted">${esc(l.member)} · ${esc(l.memberCode||'')}</div></td><td>${dateFmt(l.issuedAt)}</td><td>${dateFmt(l.dueAt)}</td><td>${dateFmt(l.returnedAt)}</td><td>${badge(l.status)}</td><td><strong>${money(l.fineDue)}</strong></td><td>${l.finePaid?badge('Paid'):l.fineDue>0?badge('Unpaid'):'—'}</td><td>${!l.returnedAt?`<button class="btn btn-sm btn-primary action-btn" data-return="${l._id}">Return</button>`:l.fineDue>0&&!l.finePaid?`<button class="btn btn-sm btn-outline-success action-btn" data-pay="${l._id}">Mark paid</button>`:'—'}</td></tr>`).join('')||emptyRow(8,'No loans recorded.'));
}
function renderReports() {
  api('/reports').then(r=>{
    const stats=[['Total titles',r.totalTitles],['Total copies',r.totalCopies],['Active loans',r.activeLoans],['Overdue loans',r.overdueLoans],['Pending reservations',r.pendingReservations],['Outstanding fines',money(r.finesOutstanding)],['Fines collected',money(r.finesCollected)]];
    $('#reportStats').html(stats.map(s=>`<div class="col-6 col-md-4 col-xl-3"><div class="stat-card"><div class="stat-label">${s[0]}</div><div class="stat-value">${s[1]}</div></div></div>`).join(''));
    $('#overdueTable').html(r.overdue.map(x=>`<tr><td>${esc(x.book)}</td><td>${esc(x.member)}</td><td>${dateFmt(x.dueAt)}</td><td>${money(x.fineDue)}</td></tr>`).join('')||emptyRow(4,'No overdue books. Great!'));
  }).catch(e=>notify(e.message,true));
}
function fillSelects() {
  const bookOptions=appState.books.map(b=>`<option value="${b._id}">${esc(b.title)} — ${b.available??0} available</option>`).join('');
  const memberOptions=appState.members.filter(m=>m.status==='Active').map(m=>`<option value="${m._id}">${esc(m.name)} (${esc(m.memberCode||'')})</option>`).join('');
  const fill=(id,options,label)=>{const old=$(id).val();$(id).html(`<option value="">Choose ${label}</option>`+options);if(old && $(id+' option[value="'+old+'"]').length)$(id).val(old);};
  fill('#reservationBook',bookOptions,'a book'); fill('#issueBook',bookOptions,'a book');
  fill('#reservationMember',memberOptions,'a member'); fill('#issueMember',memberOptions,'a member');
}
const bookFields=[['title','Book title','text',true],['author','Author','text',true],['isbn','ISBN','text',false],['category','Category','text',false],['publisher','Publisher','text',false],['year','Publication year','number',false],['copies','Total copies','number',true],['shelf','Shelf location','text',false],['description','Description','textarea',false]];
const memberFields=[['name','Full name','text',true],['email','Email address','email',true],['phone','Phone number','tel',false],['department','Department','text',false],['status','Status','select',false]];
function openRecord(type,record=null) {
  appState.type=type; appState.editing=record;
  const fields=type==='book'?bookFields:memberFields;
  $('#modalTitle').text((record?'Edit ':'Add ')+(type==='book'?'book':'member'));
  $('#modalSubtitle').text(type==='book'?'Manage catalogue details and copy count.':'Register or update a library member.');
  $('#modalError').text('');
  $('#modalFields').html(fields.map(([name,label,kind,required])=>{
    let val=record?.[name] ?? (name==='copies'?1:name==='year'?new Date().getFullYear():name==='status'?'Active':'');
    let input=kind==='textarea'?`<textarea class="form-control" name="${name}">${esc(val)}</textarea>`:
      kind==='select'?`<select class="form-select" name="${name}"><option ${val==='Active'?'selected':''}>Active</option><option ${val==='Inactive'?'selected':''}>Inactive</option></select>`:
      `<input class="form-control" name="${name}" type="${kind}" value="${esc(val)}" ${required?'required':''} ${kind==='number'?'min="1"':''}>`;
    return `<div class="col-12 ${name==='description'?'':'col-md-6'}"><label class="form-label">${label}${required?' *':''}</label>${input}</div>`;
  }).join(''));
  $('#modalSave').text(record?'Save changes':'Create record'); modal().show();
}
function showReservationForBook(bookId) { page('reservations'); $('#reservationBook').val(bookId); $('#reservationMember').trigger('focus'); }
$(document).on('click','[data-page]',function(e){e.preventDefault();page($(this).data('page'));if(appState.page==='reports')renderReports();});
$('#bookSearch').on('input',renderBooks); $('#memberSearch').on('input',renderMembers);
$('#addBookBtn').on('click',()=>openRecord('book')); $('#addMemberBtn').on('click',()=>openRecord('member'));
$('#recordForm').on('submit',async function(e){
  e.preventDefault(); const data=Object.fromEntries(new FormData(this).entries()); if(data.year)data.year=Number(data.year);if(data.copies)data.copies=Number(data.copies);
  try { await api('/'+(appState.type==='book'?'books':'members')+(appState.editing?'/'+appState.editing._id:''),{method:appState.editing?'PUT':'POST',body:JSON.stringify(data)}); modal().hide(); await refresh(); notify('Record saved successfully.'); }
  catch(err){$('#modalError').text(err.message);}
});
$('#reservationForm').on('submit',async function(e){e.preventDefault();try{await api('/reservations',{method:'POST',body:JSON.stringify({bookId:$('#reservationBook').val(),memberId:$('#reservationMember').val()})});this.reset();await refresh();notify('Reservation created.');}catch(err){notify(err.message,true);}});
$('#issueForm').on('submit',async function(e){e.preventDefault();try{await api('/loans',{method:'POST',body:JSON.stringify({bookId:$('#issueBook').val(),memberId:$('#issueMember').val(),dueAt:$('#dueDate').val(),reservationId:$('#issueForm').data('reservation-id')||null})});this.reset();$('#issueForm').removeData('reservation-id');$('#dueDate').val(dateInput(new Date(Date.now()+14*86400000)));await refresh();notify('Book issued successfully.');}catch(err){notify(err.message,true);}});
$(document).on('click','[data-edit]',function(){const type=$(this).data('edit'),id=$(this).data('id');const record=(type==='book'?appState.books:appState.members).find(x=>x._id===id);if(record)openRecord(type,record);});
$(document).on('click','[data-delete]',async function(){const type=$(this).data('delete'),id=$(this).data('id');if(!confirm(`Delete this ${type}?`))return;try{await api('/'+(type==='book'?'books':'members')+'/'+id,{method:'DELETE'});await refresh();notify(`${type==='book'?'Book':'Member'} deleted.`);}catch(e){notify(e.message,true);}});
$(document).on('click','[data-reserve-book]',function(){showReservationForBook($(this).data('reserve-book'));});
$(document).on('click','[data-cancel-res]',async function(){try{await api('/reservations/'+$(this).data('cancel-res')+'/cancel',{method:'POST',body:'{}'});await refresh();notify('Reservation cancelled.');}catch(e){notify(e.message,true);}});
$(document).on('click','[data-fulfill]',function(){
  const r=appState.reservations.find(x=>x._id===$(this).data('fulfill'));if(!r)return;
  page('loans');$('#issueBook').val(r.bookId);$('#issueMember').val(r.memberId);$('#dueDate').val(dateInput(new Date(Date.now()+14*86400000)));
  $('#issueForm').data('reservation-id',r._id); notify('Reservation selected. Confirm the issue form to fulfil it.');
});
$(document).on('click','[data-return]',async function(){try{const result=await api('/loans/'+$(this).data('return')+'/return',{method:'POST',body:'{}'});await refresh();notify(`Book returned. Fine calculated: ${money(result.fineDue)}.`);}catch(e){notify(e.message,true);}});
$(document).on('click','[data-pay]',async function(){try{await api('/loans/'+$(this).data('pay')+'/pay-fine',{method:'POST',body:'{}'});await refresh();notify('Fine marked as paid.');}catch(e){notify(e.message,true);}});
$('#exportBtn').on('click',async()=>{try{const data=await api('/export');const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='library-report-'+dateInput(new Date())+'.json';a.click();URL.revokeObjectURL(url);}catch(e){notify(e.message,true);}});
$('#dueDate').val(dateInput(new Date(Date.now()+14*86400000)));
refresh();
