import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getFirestore, 
  collection, 
  addDoc, 
  getDocs, 
  updateDoc, 
  deleteDoc, 
  doc, 
  setDoc,
  getDoc,
  query, 
  where 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { 
  getAuth, 
  onAuthStateChanged, 
  signOut, 
  createUserWithEmailAndPassword 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyD1uJ5bxyhijkiVNSopk-HJtCv075tgFXU",
  authDomain: "daralakshar.firebaseapp.com",
  databaseURL: "https://daralakshar-default-rtdb.firebaseio.com",
  projectId: "daralakshar",
  storageBucket: "daralakshar.firebasestorage.app",
  messagingSenderId: "588849018078",
  appId: "1:588849018078:web:2b1d8164517b2cf4d7fe4f"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

let systemStatuses = [];
let allCvsData = []; 
let registeredOffices = [];
let allOrdersData = [];
let cvsMapCache = {};
let systemNationalities = ["الفلبين", "كينيا", "إثيوبيا", "سريلانكا", "الهند", "أوغندا"];
let selectedWorkerTitleForEdit = null;

// التحكم في شاشة التحميل
function showLoadingOverlay() {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.style.display = 'flex';
}

function hideLoadingOverlay() {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) {
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.3s ease';
    setTimeout(() => {
      overlay.style.display = 'none';
    }, 300);
  }
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
  } else {
    showLoadingOverlay(); // إظهار شاشة التحميل عند الدخول
    try {
      await initDashboard();
      await applyUserPermissions(user.email);
    } catch (err) {
      console.error("خطأ أثناء إعداد اللوحة:", err);
    } finally {
      hideLoadingOverlay(); // إخفاء شاشة التحميل فور الانتهاء من تحميل كل البيانات
    }
  }
});

window.toggleSidebar = function() {
  const sidebar = document.getElementById('mainSidebar');
  const openBtn = document.getElementById('openSidebarBtn');
  
  if (sidebar.classList.contains('collapsed')) {
    sidebar.classList.remove('collapsed');
    if (openBtn) openBtn.style.display = 'none';
  } else {
    sidebar.classList.add('collapsed');
    if (openBtn) openBtn.style.display = 'flex';
  }
};

window.switchTab = function(tabId, event) {
  if (event) event.preventDefault();

  const currentUser = auth.currentUser;
  if (currentUser) {
    // 1. إخفاء وإزالة تفعيل جميع الأقسام والروابط
    document.querySelectorAll('.tab-content').forEach(el => {
      el.classList.remove('active');
      el.style.display = 'none';
    });

    document.querySelectorAll('.sidebar-nav a').forEach(el => {
      el.classList.remove('active');
    });

    // 2. تفعيل وإظهار القسم المطلوب فقط
    const targetTab = document.getElementById(tabId);
    if (targetTab) {
      targetTab.classList.add('active');
      targetTab.style.display = 'block';
    }

    // 3. تمييز الرابط النشط بالقائمة الجانبية
    const activeLink = document.querySelector(`.sidebar-nav a[onclick*="${tabId}"]`);
    if (activeLink) {
      activeLink.classList.add('active');
    }

    // 4. إغلاق القائمة الجانبية تلقائياً على الهواتف
    if (window.innerWidth <= 768) {
      const sidebar = document.getElementById('mainSidebar');
      if (sidebar && !sidebar.classList.contains('collapsed')) {
        toggleSidebar();
      }
    }
  }
};

async function initDashboard() {
  try {
    await loadNationalities();
    await Promise.all([
      loadStatuses(),
      loadAnnouncements(),
      calculateAnalytics(),
      loadOffices(),
      loadCategorySettings(),
      loadCvs(),
      loadUsers()
    ]);

    await Promise.all([
      loadOrders(),
      loadTracking(),
      loadArchive()
    ]);

    setupCvSearchAndFilters();
  } catch (err) {
    console.error("خطأ أثناء تحميل البيانات:", err);
  }
}

// 1. إدارة الجنسيات الموحدة للنظام
async function loadNationalities() {
  try {
    const docSnap = await getDoc(doc(db, "settings", "nationalities"));
    if (docSnap.exists() && docSnap.data().list) {
      systemNationalities = docSnap.data().list;
    } else {
      await setDoc(doc(db, "settings", "nationalities"), { list: systemNationalities });
    }
  } catch (e) {
    console.error("خطأ جلب الجنسيات:", e);
  }

  renderNationalitySelects();
  renderNationalitiesTable();
}

function renderNationalitySelects() {
  const selectElements = document.querySelectorAll('.country-dynamic-select');
  selectElements.forEach(select => {
    const currentValue = select.value;
    let html = select.id.includes('cvFilter') ? '<option value="">كل الجنسيات</option>' : '<option value="">اختر الجنسية</option>';
    systemNationalities.forEach(nat => {
      html += `<option value="${nat}">${nat}</option>`;
    });
    select.innerHTML = html;
    if (currentValue) select.value = currentValue;
  });
}

function renderNationalitiesTable() {
  const tbody = document.getElementById('nationalitiesTableBody');
  if (!tbody) return;

  if (systemNationalities.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2">لا توجد جنسيات مسجلة</td></tr>';
    return;
  }

  tbody.innerHTML = systemNationalities.map((nat) => {
    return `
      <tr>
        <td><strong>${nat}</strong></td>
        <td>
          <button class="btn-action btn-edit" onclick="renameNationality('${nat}')">تعديل الاسم</button>
          <button class="btn-action btn-delete" onclick="deleteNationality('${nat}')">حذف</button>
        </td>
      </tr>
    `;
  }).join('');
}

document.getElementById('addNationalityForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('newNationalityName');
  const name = input.value.trim();

  if (name && !systemNationalities.includes(name)) {
    systemNationalities.push(name);
    await setDoc(doc(db, "settings", "nationalities"), { list: systemNationalities });
    input.value = '';
    await loadNationalities();
    await loadCategorySettings();
    alert("تمت إضافة الجنسية بنجاح وتعميمها على اللوحات والواجهة!");
  }
});

window.renameNationality = async function(oldName) {
  const newName = prompt(`أدخل الاسم الجديد للجنسية (${oldName}):`, oldName);
  if (newName && newName.trim() !== '' && newName !== oldName) {
    const trimmed = newName.trim();
    
    const idx = systemNationalities.indexOf(oldName);
    if (idx !== -1) systemNationalities[idx] = trimmed;
    await setDoc(doc(db, "settings", "nationalities"), { list: systemNationalities });

    const cvsQ = query(collection(db, "cvs"), where("country", "==", oldName));
    const cvSnap = await getDocs(cvsQ);
    const updates = cvSnap.docs.map(d => updateDoc(doc(db, "cvs", d.id), { country: trimmed }));
    await Promise.all(updates);

    await loadNationalities();
    await loadCategorySettings();
    await loadCvs();
    alert("تم تعديل اسم الجنسية وتحديث كافة السير الذاتية المقترنة بها بنجاح!");
  }
};

window.deleteNationality = async function(natName) {
  if (confirm(`هل أنت تأكد من حذف جنسية (${natName})؟`)) {
    systemNationalities = systemNationalities.filter(n => n !== natName);
    await setDoc(doc(db, "settings", "nationalities"), { list: systemNationalities });
    await loadNationalities();
    await loadCategorySettings();
  }
};

function convertBase64AndCompress(file, maxWidth = 900, maxHeight = 1200, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (e) => reject(e);
  });
}

async function calculateAnalytics() {
  const querySnapshot = await getDocs(collection(db, "orders"));
  const now = new Date();
  const todayStr = now.toLocaleDateString('ar-SA');
  const oneDay = 24 * 60 * 60 * 1000;
  const yesterday = new Date(now.getTime() - oneDay).toLocaleDateString('ar-SA');
  
  let todayCount = 0, yesterdayCount = 0;
  let last7DaysCount = 0, prev7DaysCount = 0;
  let thisMonthCount = 0, lastMonthCount = 0;

  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  querySnapshot.forEach(docSnap => {
    const data = docSnap.data();
    if (!data.createdAt) return;

    const orderDate = new Date(data.createdAt); 
    const diffDays = Math.floor((now - orderDate) / oneDay);

    if (data.createdAt === todayStr || diffDays === 0) todayCount++;
    if (data.createdAt === yesterday || diffDays === 1) yesterdayCount++;

    if (diffDays >= 0 && diffDays < 7) last7DaysCount++;
    if (diffDays >= 7 && diffDays < 14) prev7DaysCount++;

    if (orderDate.getMonth() === currentMonth && orderDate.getFullYear() === currentYear) {
      thisMonthCount++;
    } else if (
      (currentMonth === 0 && orderDate.getMonth() === 11 && orderDate.getFullYear() === currentYear - 1) ||
      (orderDate.getMonth() === currentMonth - 1 && orderDate.getFullYear() === currentYear)
    ) {
      lastMonthCount++;
    }
  });

  document.getElementById('ordersToday').textContent = todayCount;
  document.getElementById('ordersWeek').textContent = last7DaysCount;
  document.getElementById('ordersMonth').textContent = thisMonthCount;

  renderTrend('Today', todayCount, yesterdayCount);
  renderTrend('Week', last7DaysCount, prev7DaysCount);
  renderTrend('Month', thisMonthCount, lastMonthCount);
}

function renderTrend(type, current, previous) {
  let percent = previous === 0 ? (current > 0 ? 100 : 0) : ((current - previous) / previous) * 100;
  const isUp = percent >= 0;
  const formattedPercent = Math.abs(percent).toFixed(2) + '%';

  const container = document.getElementById(`badgeContainer${type}`);
  const arrow = document.getElementById(`arrow${type}`);
  const percentText = document.getElementById(`percent${type}`);
  const iconBox = document.getElementById(`badgeIcon${type}`);

  if (!container) return;

  if (isUp) {
    container.className = "trend-badge badge-up";
    arrow.textContent = "↑";
    percentText.textContent = `+${formattedPercent}`;
    if (iconBox) {
      iconBox.className = "crypto-icon icon-up";
      iconBox.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>`;
    }
  } else {
    container.className = "trend-badge badge-down";
    arrow.textContent = "↓";
    percentText.textContent = `-${formattedPercent}`;
    if (iconBox) {
      iconBox.className = "crypto-icon icon-down";
      iconBox.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"></polyline><polyline points="17 18 23 18 23 12"></polyline></svg>`;
    }
  }
}

// 2. الإعلانات
document.getElementById('addAnnouncementForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fileInput = document.getElementById('announceImage');
  const titleInput = document.getElementById('announceTitle');
  
  if (!fileInput.files[0]) return alert("يرجى اختيار صورة الإعلان");

  const title = titleInput.value;
  const imgBase64 = await convertBase64AndCompress(fileInput.files[0], 1200, 500, 0.8);

  await addDoc(collection(db, "announcements"), {
    title,
    imageUrl: imgBase64,
    createdAt: new Date().toLocaleDateString('ar-SA')
  });

  alert("تمت إضافة الإعلان بنجاح!");
  document.getElementById('addAnnouncementForm').reset();
  loadAnnouncements();
});

async function loadAnnouncements() {
  const tbody = document.getElementById('announcementsTableBody');
  if (!tbody) return;
  
  const querySnapshot = await getDocs(collection(db, "announcements"));

  if (querySnapshot.empty) {
    tbody.innerHTML = '<tr><td colspan="4">لا توجد إعلانات حالياً</td></tr>';
    return;
  }

  tbody.innerHTML = querySnapshot.docs.map(docSnap => {
    const item = docSnap.data();
    const id = docSnap.id;
    return `
      <tr>
        <td><img src="${item.imageUrl}" style="height:45px; border-radius:6px; object-fit:cover;"></td>
        <td>${item.title}</td>
        <td>${item.createdAt || '-'}</td>
        <td>
          <button class="btn-action btn-delete" onclick="deleteAnnouncement('${id}')">حذف</button>
        </td>
      </tr>
    `;
  }).join('');
}

window.deleteAnnouncement = async function(id) {
  if (confirm("هل أنت تأكد من حذف هذا الإعلان؟")) {
    await deleteDoc(doc(db, "announcements", id));
    loadAnnouncements();
  }
};

// 3. مكاتب العمالة
document.getElementById('addOfficeForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  await addDoc(collection(db, "offices"), {
    nameAr: document.getElementById('officeNameAr').value,
    nameEn: document.getElementById('officeNameEn').value,
    countryAr: document.getElementById('officeCountryAr').value,
    countryEn: document.getElementById('officeCountryEn').value,
    createdAt: new Date().toLocaleDateString('ar-SA')
  });

  alert("تمت إضافة مكتب العمالة بنجاح!");
  document.getElementById('addOfficeForm').reset();
  await loadOffices();
});

async function loadOffices() {
  const tbody = document.getElementById('officesTableBody');
  const cvOfficeSelect = document.getElementById('cvOffice');
  const editCvOfficeSelect = document.getElementById('editCvOffice');

  const querySnapshot = await getDocs(collection(db, "offices"));
  registeredOffices = [];

  let selectOptions = '<option value="">اختر مكتب العمالة الخارجية (داخلي فقط)</option>';

  if (querySnapshot.empty) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="5">لا توجد مكاتب مسجلة</td></tr>';
  } else {
    const tableRows = [];
    querySnapshot.forEach((docSnap) => {
      const item = docSnap.data();
      const id = docSnap.id;
      registeredOffices.push({ id, ...item });

      selectOptions += `<option value="${item.nameAr}">${item.nameAr} (${item.countryAr})</option>`;

      tableRows.push(`
        <tr>
          <td><strong>${item.nameAr}</strong></td>
          <td>${item.nameEn}</td>
          <td>${item.countryAr}</td>
          <td>${item.countryEn}</td>
          <td>
            <button class="btn-action btn-delete" onclick="deleteOffice('${id}')">حذف</button>
          </td>
        </tr>
      `);
    });

    if (tbody) tbody.innerHTML = tableRows.join('');
  }

  if (cvOfficeSelect) cvOfficeSelect.innerHTML = selectOptions;
  if (editCvOfficeSelect) editCvOfficeSelect.innerHTML = selectOptions;
}

window.deleteOffice = async function(id) {
  if (confirm("هل أنت تأكد من حذف هذا المكتب؟")) {
    await deleteDoc(doc(db, "offices", id));
    loadOffices();
  }
};

// 4. الحالات
document.getElementById('addStatusForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('statusName').value;
  await addDoc(collection(db, "statuses"), { title });
  document.getElementById('addStatusForm').reset();
  loadStatuses();
});

async function loadStatuses() {
  const list = document.getElementById('statusList');
  if (!list) return;

  const querySnapshot = await getDocs(collection(db, "statuses"));
  systemStatuses = [];

  const items = querySnapshot.docs.map(docSnap => {
    const data = docSnap.data();
    const s = data.title;
    const id = docSnap.id;
    systemStatuses.push(s);
    return `
      <li style="display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid var(--border-color);">
        <span>${s}</span>
        <button class="btn-action btn-delete" onclick="deleteStatus('${id}', '${s}')">حذف</button>
      </li>
    `;
  });

  list.innerHTML = items.join('');

  if (systemStatuses.length === 0) {
    systemStatuses = ["تحت الإجراء", "تم الفحص الطبي", "ربط التأشيرة", "تم الحجز", "وصلت المملكة"];
  }
}

window.deleteStatus = async function(id, title) {
  if (confirm(`هل أنت تأكد من حذف الحالة (${title})؟`)) {
    await deleteDoc(doc(db, "statuses", id));
    loadStatuses();
  }
};

// 5. قسم إدارة الطلبات والتعديل
async function loadOrders() {
  const tbody = document.getElementById('ordersTableBody');
  if (!tbody) return;

  const q = query(collection(db, "orders"), where("status", "==", "طلب جديد"));
  const querySnapshot = await getDocs(q);
  allOrdersData = [];

  const totalCountElem = document.getElementById('totalOrdersCount');
  if (totalCountElem) totalCountElem.textContent = querySnapshot.size;

  if (querySnapshot.empty) {
    tbody.innerHTML = '<tr><td colspan="6">لا توجد طلبات جديدة حالياً</td></tr>';
    return;
  }

  const now = new Date();

  const rows = querySnapshot.docs.map((docSnapshot) => {
    const order = docSnapshot.data();
    const id = docSnapshot.id;
    allOrdersData.push({ id, ...order });
    
    const internalWorkerName = order.workerName || cvsMapCache[order.selectedItem] || '';
    const workerNameDisplay = internalWorkerName ? ` (${internalWorkerName})` : '';
    const safeOrderData = JSON.stringify({ id, ...order }).replace(/"/g, '&quot;');

    let hoursDiff = 0;
    const orderDate = order.createdAtIso ? new Date(order.createdAtIso) : (order.createdAt ? new Date(order.createdAt) : now);
    const diffTimeMs = Math.abs(now - orderDate);
    hoursDiff = Math.floor(diffTimeMs / (1000 * 60 * 60));

    let hoursColorStyle = '#27ae60';
    if (hoursDiff >= 13 && hoursDiff <= 18) {
      hoursColorStyle = '#f39c12';
    } else if (hoursDiff >= 19) {
      hoursColorStyle = '#e74c3c';
    }

    return `
      <tr>
        <td>${order.applicantName || 'غير مدون'}</td>
        <td>
          <a href="javascript:void(0)" 
             onclick="viewCvImage('${order.selectedItem}')" 
             style="color: var(--primary-color, #1a2b4c); text-decoration: underline; font-weight: bold; cursor: pointer;">
             ${order.selectedItem || '-'}
          </a>
          <span style="color:#b38b4d; font-size:12px; display:block;">${workerNameDisplay}</span>
        </td>
        <td style="font-weight: 800; font-size: 14px; color: ${hoursColorStyle}; text-align: center;">
          ${hoursDiff} ساعة
        </td>
        <td><span style="font-weight:bold; color: ${order.hasVisa ? '#27ae60' : '#d63031'}">${order.hasVisa ? 'نعم (مرفقة)' : 'لا'}</span></td>
        <td>${order.createdAt || '-'}</td>
        <td>
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <select onchange="updateRowCompletionAction('${id}', this.value)" style="padding: 4px 8px; font-size: 11px;">
              <option value="">-- إستكمال سريع --</option>
              <option value="إستكمال أبو كمال" ${order.completionAction === 'إستكمال أبو كمال' ? 'selected' : ''}>إستكمال أبو كمال</option>
              <option value="إستكمال أبو أحمد" ${order.completionAction === 'إستكمال أبو أحمد' ? 'selected' : ''}>إستكمال أبو أحمد</option>
              <option value="تحويل للمراجعة" ${order.completionAction === 'تحويل للمراجعة' ? 'selected' : ''}>تحويل للمراجعة</option>
              <option value="طباعة عقد مساند" ${order.completionAction === 'طباعة عقد مساند' ? 'selected' : ''}>طباعة عقد مساند</option>
              <option value="تأكيد الربط الإلكتروني" ${order.completionAction === 'تأكيد الربط الإلكتروني' ? 'selected' : ''}>تأكيد الربط الإلكتروني</option>
            </select>
            <div style="display: flex; gap: 4px;">
              <button class="btn-action btn-edit" onclick="openOrderEditModal(${safeOrderData})">تعديل</button>
              <button class="btn-action btn-accept" onclick="acceptOrder('${id}', '${order.selectedItem}')">قبول</button>
              <button class="btn-action btn-delete" onclick="rejectOrder('${id}', '${order.selectedItem}')">رفض</button>
            </div>
          </div>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = rows.join('');
}

window.updateRowCompletionAction = async function(orderId, actionValue) {
  try {
    await updateDoc(doc(db, "orders", orderId), {
      completionAction: actionValue
    });
  } catch (err) {
    console.error("خطأ تحديث الإستكمال:", err);
  }
};

window.openOrderEditModal = async function(order) {
  selectedWorkerTitleForEdit = order.selectedItem;
  document.getElementById('editOrderId').value = order.id;
  document.getElementById('currentSelectedCvTitle').value = order.selectedItem || '';
  
  const titleDisplay = document.getElementById('displaySelectedCvTitle');
  if (titleDisplay) titleDisplay.textContent = order.selectedItem || 'غير محدد';

  document.getElementById('editApplicantName').value = order.applicantName || '';
  document.getElementById('editIdNumber').value = order.idNumber || '';
  document.getElementById('editBirthDate').value = order.birthDate || '';
  document.getElementById('editPhoneNumber').value = order.phoneNumber || '';
  document.getElementById('editNote').value = order.note || '';

  const visa = order.visaDetails || {};
  document.getElementById('editVisaNumber').value = visa.visaNumber || '';
  document.getElementById('editVisaIssueDate').value = visa.visaIssueDate || '';
  document.getElementById('editBorderNumber').value = visa.borderNumber || '';
  document.getElementById('editEmployerName').value = visa.employerName || '';
  document.getElementById('editWorkCity').value = visa.workCity || '';
  document.getElementById('editAddress').value = visa.address || '';
  document.getElementById('editRelativeName').value = visa.relativeName || '';
  document.getElementById('editRelativeRelation').value = visa.relativeRelation || '';
  document.getElementById('editRelativePhone').value = visa.relativePhone || '';
  document.getElementById('editRelativeEmployer').value = visa.relativeEmployer || '';
  document.getElementById('editHomeFloors').value = visa.homeFloors || '';
  document.getElementById('editHomeRooms').value = visa.homeRooms || '';
  document.getElementById('editFamilyMembers').value = visa.familyMembers || '';

  const modal = document.getElementById('orderEditModal');
  if (modal) modal.style.display = 'flex';
};

window.openCvSelectorModal = function() {
  const availableGrid = document.getElementById('availableCvsGrid');
  const currentTitle = selectedWorkerTitleForEdit || document.getElementById('currentSelectedCvTitle').value;

  if (availableGrid) {
    const activeCvs = allCvsData.filter(c => c.status === 'نشط' || c.title === currentTitle);
    availableGrid.innerHTML = activeCvs.map(cv => {
      const isSelected = cv.title === currentTitle;
      return `
        <div onclick="selectCvForOrder('${cv.title}')" id="cvCard_${cv.title.replace(/\s+/g, '_')}" style="border: 2px solid ${isSelected ? 'var(--primary-blue)' : '#ddd'}; background: ${isSelected ? '#eef6fb' : '#fff'}; padding: 8px; border-radius: 8px; cursor: pointer; text-align: center; transition: all 0.2s;">
          <img src="${cv.imageUrl || 'https://via.placeholder.com/60'}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 6px;">
          <div style="font-size: 11px; font-weight: bold; margin-top: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${cv.title}</div>
          <div style="font-size: 10px; color: #777;">${cv.workerName || ''}</div>
        </div>
      `;
    }).join('');
  }

  const selectorModal = document.getElementById('cvSelectorModal');
  if (selectorModal) selectorModal.style.display = 'flex';
};

window.closeCvSelectorModal = function() {
  const selectorModal = document.getElementById('cvSelectorModal');
  if (selectorModal) selectorModal.style.display = 'none';
};

window.selectCvForOrder = function(cvTitle) {
  selectedWorkerTitleForEdit = cvTitle;
  document.querySelectorAll('#availableCvsGrid > div').forEach(el => {
    el.style.borderColor = '#ddd';
    el.style.background = '#fff';
  });
  const target = document.getElementById(`cvCard_${cvTitle.replace(/\s+/g, '_')}`);
  if (target) {
    target.style.borderColor = 'var(--primary-blue)';
    target.style.background = '#eef6fb';
  }
};

window.confirmCvSelection = function() {
  if (selectedWorkerTitleForEdit) {
    const titleDisplay = document.getElementById('displaySelectedCvTitle');
    if (titleDisplay) titleDisplay.textContent = selectedWorkerTitleForEdit;
  }
  closeCvSelectorModal();
};

window.closeOrderEditModal = function() {
  const modal = document.getElementById('orderEditModal');
  if (modal) modal.style.display = 'none';
};

document.getElementById('orderEditForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('editOrderId').value;
  const oldCvTitle = document.getElementById('currentSelectedCvTitle').value;
  const newCvTitle = selectedWorkerTitleForEdit || oldCvTitle;

  const updatedOrder = {
    selectedItem: newCvTitle,
    applicantName: document.getElementById('editApplicantName').value,
    idNumber: document.getElementById('editIdNumber').value,
    birthDate: document.getElementById('editBirthDate').value,
    phoneNumber: document.getElementById('editPhoneNumber').value,
    note: document.getElementById('editNote').value,
    visaDetails: {
      visaNumber: document.getElementById('editVisaNumber').value,
      visaIssueDate: document.getElementById('editVisaIssueDate').value,
      borderNumber: document.getElementById('editBorderNumber').value,
      employerName: document.getElementById('editEmployerName').value,
      workCity: document.getElementById('editWorkCity').value,
      address: document.getElementById('editAddress').value,
      relativeName: document.getElementById('editRelativeName').value,
      relativeRelation: document.getElementById('editRelativeRelation').value,
      relativePhone: document.getElementById('editRelativePhone').value,
      relativeEmployer: document.getElementById('editRelativeEmployer').value,
      homeFloors: document.getElementById('editHomeFloors').value,
      homeRooms: document.getElementById('editHomeRooms').value,
      familyMembers: document.getElementById('editFamilyMembers').value
    }
  };

  try {
    await updateDoc(doc(db, "orders", id), updatedOrder);

    if (oldCvTitle && oldCvTitle !== newCvTitle) {
      const oldCvQ = query(collection(db, "cvs"), where("title", "==", oldCvTitle));
      const oldCvSnap = await getDocs(oldCvQ);
      const reactivateOld = oldCvSnap.docs.map(d => updateDoc(doc(db, "cvs", d.id), { status: "نشط" }));

      const newCvQ = query(collection(db, "cvs"), where("title", "==", newCvTitle));
      const newCvSnap = await getDocs(newCvQ);
      const archiveNew = newCvSnap.docs.map(d => updateDoc(doc(db, "cvs", d.id), { status: "مؤرشف" }));

      await Promise.all([...reactivateOld, ...archiveNew]);
    } else if (newCvTitle) {
      const newCvQ = query(collection(db, "cvs"), where("title", "==", newCvTitle));
      const newCvSnap = await getDocs(newCvQ);
      const archiveNew = newCvSnap.docs.map(d => updateDoc(doc(db, "cvs", d.id), { status: "مؤرشف" }));
      await Promise.all(archiveNew);
    }

    alert("تم تعديل كافة بيانات الطلب وتأكيد تغيير العاملة بنجاح!");
    closeOrderEditModal();
    await loadOrders();
    await loadCvs();
  } catch(err) {
    console.error("خطأ التعديل:", err);
    alert("حدث خطأ أثناء تعديل الطلب.");
  }
});

window.acceptOrder = async function(id, selectedItemTitle) {
  try {
    const orderRef = doc(db, "orders", id);
    const acceptTimestamp = new Date().toISOString();

    await updateDoc(orderRef, {
      status: "مقبول",
      acceptedAt: acceptTimestamp,
      trackingStatus: systemStatuses[0] || "تحت الإجراء"
    });

    //if (selectedItemTitle) {
     // const cvQuery = query(collection(db, "cvs"), where("title", "==", selectedItemTitle));
     // const cvSnapshot = await getDocs(cvQuery);
      
     // const updatePromises = cvSnapshot.docs.map(cvDoc => updateDoc(doc(db, "cvs", cvDoc.id), { status: "مؤرشف" }));
    //  await Promise.all(updatePromises);
   // }

    alert("تم قبول الطلب ونقله إلى قسم المتابعة وأرشفة السيفي المختار فقط!");
    loadOrders();
    loadTracking();
    loadCvs();
  } catch (err) {
    console.error("خطأ أثناء قبول الطلب:", err);
    alert("حدث خطأ أثناء تنفيذ الطلب: " + err.message);
  }
};

window.rejectOrder = async function(id, selectedItemTitle) {
  if (confirm("هل أنت تأكد من رفض هذا الطلب؟")) {
    await deleteDoc(doc(db, "orders", id));
    if (selectedItemTitle) {
      const cvQuery = query(collection(db, "cvs"), where("title", "==", selectedItemTitle));
      const cvSnapshot = await getDocs(cvQuery);
      const updates = cvSnapshot.docs.map(cvDoc => updateDoc(doc(db, "cvs", cvDoc.id), { status: "نشط" }));
      await Promise.all(updates);
    }
    alert("تم رفض الطلب بنجاح!");
    loadOrders();
    loadTracking();
    loadCvs();
  }
};

// 6. قسم المتابعة
async function loadTracking() {
  const tbody = document.getElementById('trackingTableBody');
  if (!tbody) return;

  const q = query(collection(db, "orders"), where("status", "==", "مقبول"));
  const querySnapshot = await getDocs(q);

  const trackingCountElem = document.getElementById('trackingOrdersCount');
  if (trackingCountElem) trackingCountElem.textContent = querySnapshot.size;

  if (querySnapshot.empty) {
    tbody.innerHTML = '<tr><td colspan="7">لا توجد طلبات جارية تحت المتابعة</td></tr>';
    return;
  }

  const now = new Date();

  const rows = querySnapshot.docs.map(docSnap => {
    const item = docSnap.data();
    const id = docSnap.id;

    let daysDiff = 0;
    const acceptDate = item.acceptedAt ? new Date(item.acceptedAt) : (item.createdAt ? new Date(item.createdAt) : now);
    const diffTime = Math.abs(now - acceptDate);
    daysDiff = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    let colorStyle = '#27ae60';
    if (daysDiff >= 31 && daysDiff <= 45) {
      colorStyle = '#f39c12';
    } else if (daysDiff >= 46) {
      colorStyle = '#e74c3c';
    }

    let optionsHTML = systemStatuses.map(st => `<option value="${st}" ${item.trackingStatus === st ? 'selected' : ''}>${st}</option>`).join('');

    const internalWorkerName = item.workerName || cvsMapCache[item.selectedItem] || '';
    const workerNameDisplay = internalWorkerName ? ` (${internalWorkerName})` : '';
    const safeTrackingData = JSON.stringify({ id, ...item }).replace(/"/g, '&quot;');

    return `
      <tr>
        <td>${item.applicantName || '-'}</td>
        <td>
          <a href="javascript:void(0)" 
             onclick="viewCvImage('${item.selectedItem}')" 
             style="color: var(--primary-color, #1a2b4c); text-decoration: underline; font-weight: bold; cursor: pointer;">
             ${item.selectedItem || '-'}
          </a>
          <span style="color:#b38b4d; font-size:12px; display:block;">${workerNameDisplay}</span>
        </td>
        <td style="font-weight: 800; font-size: 15px; color: ${colorStyle}; text-align: center;">
          ${daysDiff} يوم
        </td>
        <td>${item.phoneNumber || '-'}</td>
        <td><strong>${item.trackingStatus || 'تحت الإجراء'}</strong></td>
        <td>
          <select onchange="updateTrackingStatus('${id}', this.value)">
            ${optionsHTML}
          </select>
        </td>
        <td>
          <button class="btn-action btn-edit" onclick="openTrackingEditModal(${safeTrackingData})">تعديل</button>
          <button class="btn-action btn-accept" onclick="completeOrder('${id}')">إنهاء الطلب</button>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = rows.join('');
}

window.openTrackingEditModal = function(item) {
  document.getElementById('editTrackingOrderId').value = item.id;
  const track = item.trackingDetails || {};

  document.getElementById('trackStatus').value = item.trackingStatus || 'تحت الإجراء';
  document.getElementById('trackPoloEntryDate').value = track.poloEntryDate || '';
  document.getElementById('trackPoloReceiveDate').value = track.poloReceiveDate || '';
  document.getElementById('trackMusanedPayDate').value = track.musanedPayDate || '';
  document.getElementById('trackMusanedLinkDate').value = track.musanedLinkDate || '';
  document.getElementById('trackMusanedSignDate').value = track.musanedSignDate || '';
  document.getElementById('trackContractNo').value = track.contractNo || '';
  document.getElementById('trackMedical').value = track.medical || '';
  document.getElementById('trackBiometric').value = track.biometric || '';
  document.getElementById('trackOWWA').value = track.owwa || '';
  document.getElementById('trackOEC').value = track.oec || '';
  document.getElementById('trackAgencyDate').value = track.agencyDate || '';
  document.getElementById('trackEmbassyEntryDate').value = track.embassyEntryDate || '';
  document.getElementById('trackVisaReceiveDate').value = track.visaReceiveDate || '';
  document.getElementById('trackTravelDate').value = track.travelDate || '';
  document.getElementById('trackNotes').value = track.notes || '';

  const modal = document.getElementById('trackingEditModal');
  if (modal) modal.style.display = 'flex';
};

window.closeTrackingEditModal = function() {
  const modal = document.getElementById('trackingEditModal');
  if (modal) modal.style.display = 'none';
};

document.getElementById('trackingEditForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('editTrackingOrderId').value;

  const trackingStatus = document.getElementById('trackStatus').value;
  const trackingDetails = {
    poloEntryDate: document.getElementById('trackPoloEntryDate').value,
    poloReceiveDate: document.getElementById('trackPoloReceiveDate').value,
    musanedPayDate: document.getElementById('trackMusanedPayDate').value,
    musanedLinkDate: document.getElementById('trackMusanedLinkDate').value,
    musanedSignDate: document.getElementById('trackMusanedSignDate').value,
    contractNo: document.getElementById('trackContractNo').value,
    medical: document.getElementById('trackMedical').value,
    biometric: document.getElementById('trackBiometric').value,
    owwa: document.getElementById('trackOWWA').value,
    oec: document.getElementById('trackOEC').value,
    agencyDate: document.getElementById('trackAgencyDate').value,
    embassyEntryDate: document.getElementById('trackEmbassyEntryDate').value,
    visaReceiveDate: document.getElementById('trackVisaReceiveDate').value,
    travelDate: document.getElementById('trackTravelDate').value,
    notes: document.getElementById('trackNotes').value
  };

  try {
    await updateDoc(doc(db, "orders", id), {
      trackingStatus: trackingStatus,
      trackingDetails: trackingDetails
    });

    alert("تم حفظ بيانات المتابعة بنجاح!");
    closeTrackingEditModal();
    loadTracking();
  } catch(err) {
    console.error("خطأ في المتابعة:", err);
    alert("حدث خطأ أثناء حفظ بيانات المتابعة.");
  }
});

window.completeOrder = async function(id) {
  if (confirm("هل أنت متأكد من إنهاء هذا الطلب ونقله إلى الأرشيف؟")) {
    try {
      const orderRef = doc(db, "orders", id);
      await updateDoc(orderRef, {
        status: "مؤرشف",
        trackingStatus: "مكتمل ومؤرشف"
      });

      alert("تم إنهاء الطلب ونقله إلى الأرشيف بنجاح!");
      loadTracking();
      loadArchive();
      calculateAnalytics();
    } catch (err) {
      console.error("خطأ أثناء إنهاء الطلب:", err);
      alert("حدث خطأ: " + err.message);
    }
  }
};

window.updateTrackingStatus = async function(id, newStatus) {
  await updateDoc(doc(db, "orders", id), { trackingStatus: newStatus });
  loadTracking();
};

// 7. الأرشيف
async function loadArchive() {
  const tbody = document.getElementById('archiveTableBody');
  if (!tbody) return;

  const q = query(collection(db, "orders"), where("status", "==", "مؤرشف"));
  const querySnapshot = await getDocs(q);

  const archiveCountElem = document.getElementById('archiveCount');
  if (archiveCountElem) archiveCountElem.textContent = querySnapshot.size;

  if (querySnapshot.empty) {
    tbody.innerHTML = '<tr><td colspan="5">الأرشيف فارغ حالياً</td></tr>';
    return;
  }

  tbody.innerHTML = querySnapshot.docs.map(docSnap => {
    const item = docSnap.data();
    return `
      <tr>
        <td>${item.applicantName || '-'}</td>
        <td>${item.selectedItem || '-'}</td>
        <td>${item.phoneNumber || '-'}</td>
        <td><span style="color:#27ae60; font-weight:bold;">${item.trackingStatus || 'مكتمل ومؤرشف'}</span></td>
        <td>${item.createdAt || '-'}</td>
      </tr>
    `;
  }).join('');
}

// 8. إدارة التصنيفات والترتيب
async function loadCategorySettings() {
  const grid = document.getElementById('countrySortGrid');
  if (!grid) return;

  const countries = systemNationalities;
  
  let currentSettings = {
    firstServiceType: "إستقدام جديد",
    countriesOrder: countries,
    firstExperience: "سبق لها العمل",
    firstJob: "عاملة منزلية"
  };

  try {
    const docSnap = await getDoc(doc(db, "settings", "categories"));
    if (docSnap.exists()) {
      currentSettings = docSnap.data();
    }
  } catch(e) {
    console.error("خطأ قراءة الترتيب:", e);
  }

  if (document.getElementById('firstServiceTypeSort')) {
    document.getElementById('firstServiceTypeSort').value = currentSettings.firstServiceType || "إستقدام جديد";
  }

  grid.innerHTML = countries.map((country, index) => {
    const currentPos = currentSettings.countriesOrder ? (currentSettings.countriesOrder.indexOf(country) + 1) : (index + 1);
    
    let options = '';
    for(let i=1; i<=countries.length; i++) {
      options += `<option value="${i}" ${currentPos === i ? 'selected' : ''}>المرتبة ${i}</option>`;
    }

    return `
      <div>
        <label style="font-size:12px; font-weight:bold; display:block; margin-bottom:4px;">جنسية ${country}:</label>
        <select class="country-priority-select" data-country="${country}">
          ${options}
        </select>
      </div>
    `;
  }).join('');

  if (document.getElementById('firstExperienceSort')) {
    document.getElementById('firstExperienceSort').value = currentSettings.firstExperience || "سبق لها العمل";
  }
  if (document.getElementById('firstJobSort')) {
    document.getElementById('firstJobSort').value = currentSettings.firstJob || "عاملة منزلية";
  }
}

document.getElementById('categoryOrderForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const countrySelects = document.querySelectorAll('.country-priority-select');
  const countryRankings = [];

  countrySelects.forEach(sel => {
    countryRankings.push({
      country: sel.getAttribute('data-country'),
      rank: parseInt(sel.value)
    });
  });

  countryRankings.sort((a, b) => a.rank - b.rank);
  const orderedCountries = countryRankings.map(c => c.country);

  const categoryConfig = {
    firstServiceType: document.getElementById('firstServiceTypeSort').value,
    countriesOrder: orderedCountries,
    firstExperience: document.getElementById('firstExperienceSort').value,
    firstJob: document.getElementById('firstJobSort').value
  };

  try {
    await setDoc(doc(db, "settings", "categories"), categoryConfig);
    alert("تم حفظ ترتيب ظهور التصنيفات بنجاح وتطبيقه على الواجهة الرئيسية!");
  } catch (err) {
    console.error("خطأ الحفظ:", err);
    alert("حدث خطأ أثناء حفظ الإعدادات: " + err.message);
  }
});

// 9. السير الذاتية
document.getElementById('addCvForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fileInput = document.getElementById('cvImage');
  let imgBase64 = fileInput.files[0] ? await convertBase64AndCompress(fileInput.files[0]) : '';

  await addDoc(collection(db, "cvs"), {
    title: document.getElementById('cvTitle').value,
    workerName: document.getElementById('cvWorkerName').value || '',
    officeName: document.getElementById('cvOffice')?.value || '',
    job: document.getElementById('cvJob').value,
    serviceType: document.getElementById('cvServiceType').value,
    country: document.getElementById('cvCountry').value,
    religion: document.getElementById('cvReligion').value,
    experience: document.getElementById('cvExperience').value,
    imageUrl: imgBase64,
    status: "نشط",
    createdAt: new Date().toLocaleDateString('ar-SA')
  });

  alert("تم نشر السيرة الذاتية بنجاح!");
  document.getElementById('addCvForm').reset();
  loadCvs();
});

async function loadCvs() {
  const tbody = document.getElementById('cvsTableBody');
  if (!tbody) return;

  const querySnapshot = await getDocs(collection(db, "cvs"));
  allCvsData = [];
  cvsMapCache = {};
  let active = 0;

  querySnapshot.forEach((docSnap) => {
    const item = docSnap.data();
    const id = docSnap.id;
    if (item.status === 'نشط') active++;
    allCvsData.push({ id, ...item });
    cvsMapCache[item.title] = item.workerName || '';
  });

  const activeCvsElem = document.getElementById('activeCvsCount');
  if (activeCvsElem) activeCvsElem.textContent = active;

  renderCvsTable(allCvsData);
}

function renderCvsTable(dataList) {
  const tbody = document.getElementById('cvsTableBody');
  if (!tbody) return;

  if (dataList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9">لا توجد سير ذاتية مطابقة لنتيجة البحث والفلترة</td></tr>';
    return;
  }

  tbody.innerHTML = dataList.map((item) => {
    const safeData = JSON.stringify(item).replace(/"/g, '&quot;');
    return `
      <tr>
        <td><img src="${item.imageUrl || 'https://via.placeholder.com/40'}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;"></td>
        <td>${item.title}</td>
        <td><strong>${item.job || 'عاملة منزلية'}</strong></td>
        <td>${item.serviceType || 'إستقدام جديد'}</td>
        <td><strong style="color:#b38b4d;">${item.workerName || 'غير محدد'}</strong></td>
        <td><span style="background:#f1f5f9; padding:3px 8px; border-radius:6px; font-weight:bold; font-size:11px;">${item.officeName || 'غير محدد'}</span></td>
        <td>${item.country}</td>
        <td>${item.status}</td>
        <td>
          <button class="btn-action btn-edit" onclick="openEditCvModal(${safeData})">تعديل</button>
          <button class="btn-action btn-archive" onclick="toggleArchive('${item.id}', '${item.status}')">${item.status === 'نشط' ? 'أرشفة' : 'تفعيل'}</button>
          <button class="btn-action btn-delete" onclick="deleteCv('${item.id}')">حذف</button>
        </td>
      </tr>
    `;
  }).join('');
}

function setupCvSearchAndFilters() {
  const searchInput = document.getElementById('cvSearchInput');
  const countryFilter = document.getElementById('cvFilterCountry');
  const jobFilter = document.getElementById('cvFilterJob');
  const serviceFilter = document.getElementById('cvFilterService');

  function applyFilters() {
    const term = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const selectedCountry = countryFilter ? countryFilter.value : '';
    const selectedJob = jobFilter ? jobFilter.value : '';
    const selectedService = serviceFilter ? serviceFilter.value : '';

    const filtered = allCvsData.filter(item => {
      const matchesSearch = !term || 
        (item.workerName || '').toLowerCase().includes(term) ||
        (item.title || '').toLowerCase().includes(term) ||
        (item.country || '').toLowerCase().includes(term);

      const matchesCountry = !selectedCountry || item.country === selectedCountry;
      const matchesJob = !selectedJob || item.job === selectedJob;
      const matchesService = !selectedService || item.serviceType === selectedService;

      return matchesSearch && matchesCountry && matchesJob && matchesService;
    });

    renderCvsTable(filtered);
  }

  if (searchInput) searchInput.addEventListener('input', applyFilters);
  if (countryFilter) countryFilter.addEventListener('change', applyFilters);
  if (jobFilter) jobFilter.addEventListener('change', applyFilters);
  if (serviceFilter) serviceFilter.addEventListener('change', applyFilters);
}

window.openEditCvModal = function(cvData) {
  document.getElementById('editCvId').value = cvData.id;
  document.getElementById('editCvTitle').value = cvData.title || '';
  document.getElementById('editCvWorkerName').value = cvData.workerName || '';
  if (document.getElementById('editCvOffice')) {
    document.getElementById('editCvOffice').value = cvData.officeName || '';
  }
  document.getElementById('editCvJob').value = cvData.job || '';
  document.getElementById('editCvServiceType').value = cvData.serviceType || '';
  document.getElementById('editCvCountry').value = cvData.country || '';
  document.getElementById('editCvReligion').value = cvData.religion || '';
  document.getElementById('editCvExperience').value = cvData.experience || '';
  
  const modal = document.getElementById('editCvModal');
  if (modal) modal.style.display = 'flex';
};

window.closeEditCvModal = function() {
  const modal = document.getElementById('editCvModal');
  if (modal) modal.style.display = 'none';
};

document.getElementById('editCvForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('editCvId').value;
  const fileInput = document.getElementById('editCvImage');

  const updateData = {
    title: document.getElementById('editCvTitle').value,
    workerName: document.getElementById('editCvWorkerName').value,
    officeName: document.getElementById('editCvOffice')?.value || '',
    job: document.getElementById('editCvJob').value,
    serviceType: document.getElementById('editCvServiceType').value,
    country: document.getElementById('editCvCountry').value,
    religion: document.getElementById('editCvReligion').value,
    experience: document.getElementById('editCvExperience').value
  };

  if (fileInput.files[0]) {
    updateData.imageUrl = await convertBase64AndCompress(fileInput.files[0]);
  }

  try {
    await updateDoc(doc(db, "cvs", id), updateData);
    alert("تم تعديل بيانات السيرة الذاتية بنجاح!");
    closeEditCvModal();
    loadCvs();
  } catch (err) {
    console.error("خطأ أثناء التعديل:", err);
    alert("حدث خطأ أثناء حفظ التعديلات: " + err.message);
  }
});

window.toggleArchive = async function(id, cur) {
  await updateDoc(doc(db, "cvs", id), { status: cur === 'نشط' ? 'مؤرشف' : 'نشط' });
  loadCvs();
};

window.deleteCv = async function(id) {
  if (confirm("هل أنت تأكد من الحذف النهائي؟")) {
    await deleteDoc(doc(db, "cvs", id));
    loadCvs();
  }
};

window.viewCvImage = async function(selectedItemTitle) {
  try {
    const q = query(collection(db, "cvs"), where("title", "==", selectedItemTitle));
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
      alert("لم يتم العثور على صورة السيرة الذاتية لهذا الطلب.");
      return;
    }

    let imageUrl = '';
    querySnapshot.forEach(docSnap => {
      imageUrl = docSnap.data().imageUrl;
    });

    if (!imageUrl) {
      alert("لا تتوفر صورة لهذا السيفي.");
      return;
    }

    const imgWindow = window.open("", "_blank");
    imgWindow.document.write(`
      <html>
        <head><title>معاينة السيرة الذاتية - ${selectedItemTitle}</title></head>
        <body style="margin:0; display:flex; justify-content:center; align-items:center; background:#111; height:100vh;">
          <img src="${imageUrl}" style="max-width:95%; max-height:95vh; border-radius:8px; box-shadow:0 0 20px rgba(0,0,0,0.5);">
        </body>
      </html>
    `);
  } catch (err) {
    console.error("خطأ أثناء جلب السيرة الذاتية:", err);
  }
};

// 10. إدارة الحسابات
document.getElementById('addUserForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('newUserEmail').value;
  const password = document.getElementById('newUserPassword').value;

  try {
    await createUserWithEmailAndPassword(auth, email, password);
    await addDoc(collection(db, "users"), { email, createdAt: new Date().toLocaleDateString('ar-SA') });
    alert("تم إنشاء مسؤول جديد بنجاح!");
    document.getElementById('addUserForm').reset();
    loadUsers();
  } catch (err) {
    alert("خطأ: " + err.message);
  }
});

// دالة تحميل قائمة المسؤولين وعرض صلاحيات كل حساب
async function loadUsers() {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;

  try {
    const querySnapshot = await getDocs(collection(db, "users"));
    if (querySnapshot.empty) {
      tbody.innerHTML = '<tr><td colspan="4">لا يوجد حسابات مسؤولين مسجلة</td></tr>';
      return;
    }

    const rows = querySnapshot.docs.map(docSnap => {
      const user = docSnap.data();
      const id = docSnap.id;
      const perms = user.permissions || [];
      const permSummary = perms.length === 0 ? '<span style="color:#e74c3c">لا توجد صلاحيات</span>' : `<span style="color:#27ae60; font-weight:bold">${perms.length} أقسام مسموحة</span>`;

      return `
        <tr>
          <td>${user.email}</td>
          <td>${user.createdAt || '-'}</td>
          <td>${permSummary}</td>
          <td>
            <button class="btn-action btn-edit" onclick="openPermissionsModal('${id}', ${JSON.stringify(perms).replace(/"/g, '&quot;')})">⚙️ صلاحيات الحساب</button>
            <button class="btn-action btn-delete" onclick="deleteUser('${id}')">حذف</button>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = rows.join('');
  } catch (err) {
    console.error("خطأ جلب الحسابات:", err);
  }
}

// فتح نافذة الصلاحيات وتحديد خانات الاختيار
window.openPermissionsModal = function(userId, currentPermissions = []) {
  document.getElementById('permUserId').value = userId;

  const checkboxes = document.querySelectorAll('#permissionsCheckboxesGroup input[type="checkbox"]');
  checkboxes.forEach(cb => {
    cb.checked = currentPermissions.includes(cb.value);
  });

  document.getElementById('permissionsModal').style.display = 'flex';
};

window.closePermissionsModal = function() {
  document.getElementById('permissionsModal').style.display = 'none';
};

// حفظ الصلاحيات المحددة في Firebase
document.getElementById('permissionsForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const userId = document.getElementById('permUserId').value;
  
  const selectedPermissions = [];
  document.querySelectorAll('#permissionsCheckboxesGroup input[type="checkbox"]:checked').forEach(cb => {
    selectedPermissions.push(cb.value);
  });

  try {
    await updateDoc(doc(db, "users", userId), {
      permissions: selectedPermissions
    });

    alert("تم حفظ وتحديث صلاحيات الحساب بنجاح!");
    closePermissionsModal();
    loadUsers();
  } catch (err) {
    console.error("خطأ حفظ الصلاحيات:", err);
    alert("حدث خطأ أثناء حفظ الصلاحيات.");
  }
});

// دالة تطبيق الصلاحيات على المستخدم الحالي وإخفاء الأقسام غير المسموحة
async function applyUserPermissions(userEmail) {
  try {
    const q = query(collection(db, "users"), where("email", "==", userEmail));
    const snap = await getDocs(q);
    
    if (!snap.empty) {
      const userData = snap.docs[0].data();
      const perms = userData.permissions || [];

      // إذا كان مدير النظام (Admin) أو يمتلك جميع الصلاحيات (*) لا يتم إخفاء أي شيء
      if (userData.role === 'admin' || perms.includes('*')) return;

      // 1. إخفاء أزرار القائمة الجانبية غير المصرح بها
      document.querySelectorAll('.sidebar-nav a.nav-link').forEach(link => {
        const onclickAttr = link.getAttribute('onclick') || '';
        const match = onclickAttr.match(/'([^']+)'/);
        if (match && match[1]) {
          const tabId = match[1];
          if (!perms.includes(tabId)) {
            link.style.display = 'none';
          }
        }
      });

      // 2. إخفاء جميع محتويات الأقسام (tab-content) غير المسموحة فورًا
      document.querySelectorAll('.tab-content').forEach(tab => {
        if (!perms.includes(tab.id)) {
          tab.classList.remove('active');
          tab.style.display = 'none';
        }
      });

      // 3. فتح أول قسم مسموح للمستخدم تلقائيًا
      if (perms.length > 0) {
        switchTab(perms[0]);
      } else {
        alert("حسابك لا يمتلك صلاحية الوصول لأي قسم. يرجى مراجعة المسؤول.");
      }
    }
  } catch (e) {
    console.error("خطأ تطبيق الصلاحيات:", e);
  }
}

window.deleteUser = async function(id, email) {
  if (confirm(`هل أنت تأكد من حذف حساب المسؤول (${email})؟`)) {
    await deleteDoc(doc(db, "users", id));
    loadUsers();
  }
};