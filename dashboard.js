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
  where, 
  limit,
  startAfter,
  orderBy,
  getCountFromServer
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

const TELEGRAM_BOT_TOKEN = "8967937243:AAGAepEyU1j0HQOC-5Ko43VmAhpUd6DnUpc";
const TELEGRAM_CHAT_ID = "-1004478651730";

// إحداثيات المكتب الثابتة لنظام الحضور (المبرز، المكاتب الرئيسية)
const OFFICE_LAT = 25.404126;
const OFFICE_LNG = 49.558386;
const MAX_ALLOWED_DISTANCE_METERS = 400; // النطاق المسموح به بالمتر

let systemStatuses = [];
let allCvsData = []; 
let registeredOffices = [];
let allOrdersData = [];
let cvsMapCache = {};
let systemNationalities = ["الفلبين", "كينيا", "إثيوبيا", "سريلانكا", "الهند", "أوغندا"];
let selectedWorkerTitleForEdit = null;

// متغيرات الترقيم لـ 10 عناصر لكل صفحة
let ordersPage = 1, trackingPage = 1, archivePage = 1, cvsPage = 1, cvArchivePage = 1;
const PAGE_SIZE_10 = 10;

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
    showLoadingOverlay();
    try {
      await initDashboard();
      await applyUserPermissions(user.email);
    } catch (err) {
      console.error("خطأ أثناء إعداد اللوحة:", err);
    } finally {
      hideLoadingOverlay();
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
    document.querySelectorAll('.tab-content').forEach(el => {
      el.classList.remove('active');
      el.style.display = 'none';
    });

    document.querySelectorAll('.sidebar-nav a').forEach(el => {
      el.classList.remove('active');
    });

    const targetTab = document.getElementById(tabId);
    if (targetTab) {
      targetTab.classList.add('active');
      targetTab.style.display = 'block';
    }

    const activeLink = document.querySelector(`.sidebar-nav a[onclick*="${tabId}"]`);
    if (activeLink) {
      activeLink.classList.add('active');
    }

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
      loadOldData(),
      setupDashboardSearchFilters(), 
      loadUsers(),
      loadAttendanceLogs()
    ]);

    await Promise.all([
      loadOrders(),
      loadTracking(),
      loadArchive()
    ]);

    setupCvSearchAndFilters();
    setupCvArchiveSearchAndFilters();
    setupOldDataSearch();
  } catch (err) {
    console.error("خطأ أثناء تحميل البيانات:", err);
  }
}

async function sendTelegramAcceptNotification(orderData) {
  try {
    let message = `✅ *تم قبول الطلب بنجاح!* ✅\n\n`;
    message += `👤 *اسم العميل:* ${orderData.applicantName || '-'}\n`;
    message += `🪪 *رقم الهوية:* ${orderData.idNumber || '-'}\n`;
    message += `📞 *رقم الجوال:* ${orderData.phoneNumber || '-'}\n`;
    message += `📄 *السيرة الذاتية المختارة:* ${orderData.selectedItem || '-'}\n`;
    message += `⏰ *تاريخ ووقت القبول:* ${new Date().toLocaleString('ar-SA')}\n`;

    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "Markdown"
      })
    });
  } catch (err) {
    console.error("خطأ إرسال إشعار القبول للتليجرام:", err);
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
            width = maxHeight;
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

// ==========================================
// إدارة قسم (داتا قديمة - oldRequests)
// ==========================================

let allOldData = [];
let currentPage = 1;
const pageSize = 10;
let totalPages = 1;
let pageDocsMap = {}; 
let oldDataSearchTimeout = null;

function setupOldDataSearch() {
  const searchInput = document.getElementById('oldDataSearchInput');
  const nameSearchInput = document.getElementById('oldDataNameSearchInput');
  if (!searchInput && !nameSearchInput) return;

  const performSearch = () => {
    const term = searchInput ? searchInput.value.trim() : '';
    const nameTerm = nameSearchInput ? nameSearchInput.value.trim() : '';
    clearTimeout(oldDataSearchTimeout);

    if (!term && !nameTerm) {
      loadOldData(1);
      return;
    }

    oldDataSearchTimeout = setTimeout(async () => {
      const tbody = document.getElementById('oldDataTableBody');
      const paginationContainer = document.getElementById('oldDataPagination');
      if (!tbody) return;

      tbody.innerHTML = '<tr><td colspan="4">جاري البحث في كامل قاعدة البيانات...</td></tr>';
      if (paginationContainer) paginationContainer.innerHTML = '';

      try {
        const searchResultsMap = new Map();
        const collRef = collection(db, "oldRequests");
        const queries = [];

        if (term) {
          const termAsNumber = !isNaN(term) ? Number(term) : null;

          queries.push(getDocs(query(collRef, where("IdentityId", "==", term))));
          queries.push(getDocs(query(collRef, where("phoneNumber", "==", term))));
          queries.push(getDocs(query(collRef, where("Phone", "==", term))));
          queries.push(getDocs(query(collRef, where("orderNumber", "==", term))));
          queries.push(getDocs(query(collRef, where("orderNo", "==", term))));
          queries.push(getDoc(doc(db, "oldRequests", term)));

          if (termAsNumber !== null) {
            queries.push(getDocs(query(collRef, where("IdentityId", "==", termAsNumber))));
            queries.push(getDocs(query(collRef, where("phoneNumber", "==", termAsNumber))));
            queries.push(getDocs(query(collRef, where("Phone", "==", termAsNumber))));
            queries.push(getDocs(query(collRef, where("orderNumber", "==", termAsNumber))));
          }
        }

        if (nameTerm) {
          const endStr = nameTerm + '\uf8ff';
          queries.push(getDocs(query(collRef, orderBy("Name"), where("Name", ">=", nameTerm), where("Name", "<=", endStr))));
          queries.push(getDocs(query(collRef, orderBy("name"), where("name", ">=", nameTerm), where("name", "<=", endStr))));
          queries.push(getDocs(query(collRef, orderBy("applicantName"), where("applicantName", ">=", nameTerm), where("applicantName", "<=", endStr))));
          
          queries.push(getDocs(query(collRef, where("Name", "==", nameTerm))));
          queries.push(getDocs(query(collRef, where("name", "==", nameTerm))));
        }

        const snapshots = await Promise.all(queries);

        snapshots.forEach(snap => {
          if (!snap) return;
          if (snap.exists && snap.exists()) {
            searchResultsMap.set(snap.id, { id: snap.id, ...snap.data() });
          } else if (snap.forEach) {
            snap.forEach(docSnap => {
              searchResultsMap.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
            });
          }
        });

        const finalResults = Array.from(searchResultsMap.values());

        if (finalResults.length === 0) {
          tbody.innerHTML = '<tr><td colspan="4">لم يتم العثور على أي طلب مطابق في كامل الداتا القديمة</td></tr>';
        } else {
          renderOldDataTable(finalResults);
        }
      } catch (err) {
        console.error("خطأ أثناء البحث الشامل:", err);
        tbody.innerHTML = '<tr><td colspan="4">حدث خطأ أثناء إجراء البحث في السيرفر</td></tr>';
      }
    }, 400);
  };

  if (searchInput) searchInput.addEventListener('input', performSearch);
  if (nameSearchInput) nameSearchInput.addEventListener('input', performSearch);
}

async function loadOldData(page = 1) {
  const tbody = document.getElementById('oldDataTableBody');
  if (!tbody) return;

  try {
    tbody.innerHTML = '<tr><td colspan="3">جاري جلب الطلبات...</td></tr>';
    currentPage = page;

    const collRef = collection(db, "oldRequests");
    const countSnapshot = await getCountFromServer(collRef);
    const totalCount = countSnapshot.data().count;
    totalPages = Math.ceil(totalCount / pageSize) || 1;

    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    let q;
    if (currentPage === 1) {
      q = query(collRef, orderBy("__name__"), limit(pageSize));
    } else if (pageDocsMap[currentPage - 1]) {
      q = query(collRef, orderBy("__name__"), startAfter(pageDocsMap[currentPage - 1]), limit(pageSize));
    } else {
      currentPage = 1;
      q = query(collRef, orderBy("__name__"), limit(pageSize));
    }

    const querySnapshot = await getDocs(q);
    allOldData = [];

    if (querySnapshot.empty) {
      tbody.innerHTML = '<tr><td colspan="3">لا توجد طلبات سابقة مسجلة حالياً</td></tr>';
      renderOldDataPagination();
      return;
    }

    const lastDoc = querySnapshot.docs[querySnapshot.docs.length - 1];
    pageDocsMap[currentPage] = lastDoc;

    querySnapshot.forEach((docSnap) => {
      allOldData.push({ id: docSnap.id, ...docSnap.data() });
    });

    renderOldDataTable(allOldData);
    renderOldDataPagination();
  } catch (err) {
    console.error("خطأ تحميل الداتا القديمة:", err);
    tbody.innerHTML = '<tr><td colspan="3">حدث خطأ أثناء تحميل البيانات</td></tr>';
  }
}

function renderOldDataPagination() {
  const container = document.getElementById('oldDataPagination');
  if (!container) return;

  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = `<div style="display: flex; gap: 8px; justify-content: center; align-items: center; margin-top: 15px; flex-wrap: wrap;">`;

  if (currentPage > 1) {
    html += `<button class="btn-action" style="background:#1a2b4c; color:#fff;" onclick="loadOldData(${currentPage - 1})">السابق</button>`;
  }

  [1, 2].forEach(p => {
    if (p <= totalPages) {
      const activeStyle = p === currentPage ? 'background: #1c5276; color: #fff; font-weight: bold;' : 'background: #f0f0f0; color: #333;';
      html += `<button style="padding: 6px 12px; border: 1px solid #ccc; border-radius: 4px; cursor: pointer; ${activeStyle}" onclick="goToOldDataPage(${p})">${p}</button>`;
    }
  });

  if (currentPage < totalPages) {
    html += `<button class="btn-action" style="background:#1a2b4c; color:#fff; cursor:pointer;" onclick="loadOldData(${currentPage + 1})">التالي</button>`;
  }

  html += `
    <div style="display: flex; align-items: center; gap: 5px; margin-right: 10px;">
      <span style="font-size: 12px; color: #555;">الذهاب إلى صفحة:</span>
      <input type="number" id="customPageInput" min="1" max="${totalPages}" placeholder="رقم" style="width: 60px; padding: 4px; text-align: center; border: 1px solid #ccc; border-radius: 4px;">
      <button class="btn-action" style="background: #b38b4d; color: #fff;" onclick="submitJumpToPage()">انتقال</button>
    </div>
    <span style="font-size: 12px; color: #777;">(إجمالي الصفحات: ${totalPages})</span>
  `;

  html += `</div>`;
  container.innerHTML = html;
}

window.goToOldDataPage = function(targetPage) {
  if (targetPage === currentPage) return;
  loadOldData(targetPage);
};

window.submitJumpToPage = function() {
  const input = document.getElementById('customPageInput');
  if (!input) return;
  const pageNum = parseInt(input.value);

  if (isNaN(pageNum) || pageNum < 1 || pageNum > totalPages) {
    alert(`يرجى إدخال رقم صفحة صحيح بين 1 و ${totalPages}`);
    return;
  }

  goToOldDataPage(pageNum);
};

window.loadOldData = loadOldData;

function renderOldDataTable(dataList) {
  const tbody = document.getElementById('oldDataTableBody');
  if (!tbody) return;

  if (dataList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4">لا توجد نتائج مطابقة</td></tr>';
    return;
  }

  tbody.innerHTML = dataList.map((item, index) => {
    const safeData = JSON.stringify(item).replace(/"/g, '&quot;');
    const orderNumber = item.orderNumber || item.orderNo || item.idNumber || item.id || `REQ-${index + 1}`;
    const clientName = item.Name || item.name || item.clientName || 'غير مدون';

    return `
      <tr>
        <td><strong>${orderNumber}</strong></td>
        <td><span style="font-weight: bold; color: var(--primary-color, #1a2b4c);">${clientName}</span></td>
        <td>
          <button class="btn-action btn-edit" onclick="viewOldDataDetails(${safeData})">👁️ عرض</button>
        </td>
        <td>
          <button class="btn-action btn-delete" onclick="deleteOldData('${item.id}')">حذف</button>
        </td>
      </tr>
    `;
  }).join('');
}

window.viewOldDataDetails = function(data) {
  const contentDiv = document.getElementById('oldDataDetailsContent');
  if (!contentDiv) return;

  let html = '<div style="display: flex; flex-direction: column; gap: 10px; max-height: 400px; overflow-y: auto;">';

  const renderValue = (val) => {
    if (val === null || val === undefined) return '-';
    if (typeof val === 'object') {
      return `<pre style="background:#f4f4f4; padding:5px; border-radius:4px; font-size:11px; margin:0;">${JSON.stringify(val, null, 2)}</pre>`;
    }
    if (typeof val === 'string' && val.startsWith('data:image')) {
      return `<br><img src="${val}" style="max-width:100%; max-height:150px; border-radius:8px; margin-top:5px; object-fit:contain;">`;
    }
    return val;
  };

  const fieldLabels = {
    id: "معرف المستند",
    orderNumber: "رقم الطلب",
    applicantName: "اسم العميل",
    phoneNumber: "رقم الجوال",
    idNumber: "رقم الهوية",
    selectedItem: "السيرة الذاتية / العامل",
    status: "الحالة",
    createdAt: "تاريخ الطلب",
    title: "العنوان",
    workerName: "اسم العاملة",
    officeName: "المكتب الخارجي",
    job: "الوظيفة",
    serviceType: "نوع الخدمة",
    country: "الجنسية",
    religion: "الديانة",
    experience: "الخبرة"
  };

  for (const [key, value] of Object.entries(data)) {
    const label = fieldLabels[key] || key;
    html += `
      <div style="border-bottom: 1px solid #eee; padding-bottom: 8px;">
        <span style="font-weight: bold; color: var(--primary-color, #1a2b4c); font-size: 13px;">${label}:</span>
        <div style="font-size: 13px; color: #333; margin-top: 2px;">${renderValue(value)}</div>
      </div>
    `;
  }

  html += '</div>';
  contentDiv.innerHTML = html;

  const modal = document.getElementById('oldDataDetailsModal');
  if (modal) modal.style.display = 'flex';
};

window.closeOldDataDetailsModal = function() {
  const modal = document.getElementById('oldDataDetailsModal');
  if (modal) modal.style.display = 'none';
};

window.deleteOldData = async function(id) {
  if (confirm("هل أنت متأكد من حذف هذا العنصر من البيانات القديمة؟")) {
    await deleteDoc(doc(db, "oldRequests", id));
    loadOldData();
  }
};

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

// دالة عامة لإنشاء عناصر التنقل بين الصفحات (Pagination)
function renderCustomPagination(containerId, totalItems, currentPage, onPageChange) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const totalPages = Math.ceil(totalItems / PAGE_SIZE_10) || 1;
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = `<div style="display: flex; gap: 6px; justify-content: center; align-items: center; margin-top: 15px; flex-wrap: wrap;">`;
  if (currentPage > 1) {
    html += `<button class="btn-action" style="background:#1a2b4c; color:#fff;" onclick="${onPageChange}(${currentPage - 1})">السابق</button>`;
  }

  for (let p = 1; p <= totalPages; p++) {
    const activeStyle = p === currentPage ? 'background: #1c5276; color: #fff; font-weight: bold;' : 'background: #f0f0f0; color: #333;';
    html += `<button style="padding: 4px 10px; border: 1px solid #ccc; border-radius: 4px; cursor: pointer; ${activeStyle}" onclick="${onPageChange}(${p})">${p}</button>`;
  }

  if (currentPage < totalPages) {
    html += `<button class="btn-action" style="background:#1a2b4c; color:#fff;" onclick="${onPageChange}(${currentPage + 1})">التالي</button>`;
  }
  html += ` <span style="font-size: 11px; color: #777;">(صفحة ${currentPage} من ${totalPages})</span></div>`;

  container.innerHTML = html;
}

// 5. قسم إدارة الطلبات والتعديل (محدد لـ 10 نتائج للصفحة)
async function loadOrders(page = 1) {
  ordersPage = page;
  const tbody = document.getElementById('ordersTableBody');
  if (!tbody) return;

  const q = query(collection(db, "orders"), where("status", "==", "طلب جديد"));
  const querySnapshot = await getDocs(q);
  allOrdersData.sort((a, b) => {
    const dateA = new Date(a.createdAtIso || a.createdAt || 0);
    const dateB = new Date(b.createdAtIso || b.createdAt || 0);
    return dateB - dateA;
  });

  querySnapshot.forEach(docSnap => {
    allOrdersData.push({ id: docSnap.id, ...docSnap.data() });
  });

  const totalCountElem = document.getElementById('totalOrdersCount');
  if (totalCountElem) totalCountElem.textContent = allOrdersData.length;

  if (allOrdersData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">لا توجد طلبات جديدة حالياً</td></tr>';
    renderCustomPagination('ordersPagination', 0, 1, 'changeOrdersPage');
    return;
  }

  const startIndex = (ordersPage - 1) * PAGE_SIZE_10;
  const pageData = allOrdersData.slice(startIndex, startIndex + PAGE_SIZE_10);

  const now = new Date();

  const rows = pageData.map((order) => {
    const id = order.id;
    const internalWorkerName = order.workerName || cvsMapCache[order.selectedItem] || '';
    const workerNameDisplay = internalWorkerName ? ` (${internalWorkerName})` : '';
    const safeOrderData = JSON.stringify(order).replace(/"/g, '&quot;');

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
  renderCustomPagination('ordersPagination', allOrdersData.length, ordersPage, 'changeOrdersPage');
}

window.changeOrdersPage = function(p) { loadOrders(p); };

window.updateRowCompletionAction = async function(orderId, actionValue) {
  try {
    await updateDoc(doc(db, "orders", orderId), { completionAction: actionValue });
  } catch (err) {
    console.error("خطأ تحديث الإستكمال:", err);
  }
};

window.openOrderEditModal = async function(order) {
  selectedWorkerTitleForEdit = order.selectedItem;

  const setVal = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value || '';
  };

  setVal('editOrderId', order.id);
  setVal('currentSelectedCvTitle', order.selectedItem);
  
  const titleDisplay = document.getElementById('displaySelectedCvTitle');
  if (titleDisplay) titleDisplay.textContent = order.selectedItem || 'غير محدد';

  setVal('editApplicantName', order.applicantName);
  setVal('editIdNumber', order.idNumber);
  setVal('editBirthDate', order.birthDate);
  setVal('editPhoneNumber', order.phoneNumber);
  setVal('editNote', order.note);

  const hasVisaCheckbox = document.getElementById('editHasVisa');
  if (hasVisaCheckbox) {
    hasVisaCheckbox.checked = !!order.hasVisa;
    if (typeof window.toggleEditVisaFields === 'function') {
      window.toggleEditVisaFields();
    }
  }

  const visa = order.visaDetails || {};
  setVal('editVisaNumber', visa.visaNumber);
  setVal('editVisaIssueDate', visa.visaIssueDate);
  setVal('editBorderNumber', visa.borderNumber);
  setVal('editEmployerName', visa.employerName);
  setVal('editWorkCity', visa.workCity);
  setVal('editAddress', visa.address);
  setVal('editRelativeName', visa.relativeName);
  setVal('editRelativeRelation', visa.relativeRelation);
  setVal('editRelativePhone', visa.relativePhone);
  setVal('editRelativeEmployer', visa.relativeEmployer);
  setVal('editHomeFloors', visa.homeFloors);
  setVal('editHomeRooms', visa.homeRooms);
  setVal('editFamilyMembers', visa.familyMembers);

  const modal = document.getElementById('orderEditModal');
  if (modal) modal.style.display = 'flex';
};

window.toggleEditVisaFields = function() {
  const hasVisa = document.getElementById('editHasVisa')?.checked || false;
  const visaGroup = document.getElementById('editVisaFieldsGroup');
  if (visaGroup) {
    visaGroup.style.display = hasVisa ? 'grid' : 'none';
  }
};

window.openCvSelectorModal = function() {
  const availableGrid = document.getElementById('availableCvsGrid');
  const currentTitle = selectedWorkerTitleForEdit || document.getElementById('currentSelectedCvTitle')?.value;

  if (availableGrid) {
    const activeCvs = allCvsData.filter(c => c.status === 'نشط' || c.title === currentTitle);
    availableGrid.innerHTML = activeCvs.map(cv => {
      const isSelected = cv.title === currentTitle;
      return `
        <div onclick="selectCvForOrder('${cv.title.replace(/'/g, "\\'")}')" id="cvCard_${cv.title.replace(/\s+/g, '_')}" style="border: 2px solid ${isSelected ? 'var(--primary-blue)' : '#ddd'}; background: ${isSelected ? '#eef6fb' : '#fff'}; padding: 8px; border-radius: 8px; cursor: pointer; text-align: center; transition: all 0.2s;">
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
  const safeId = `cvCard_${cvTitle.replace(/\s+/g, '_')}`;
  const target = document.getElementById(safeId);
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
  const isHasVisaChecked = document.getElementById('editHasVisa')?.checked || false;

  const updatedOrder = {
    selectedItem: newCvTitle,
    applicantName: document.getElementById('editApplicantName').value,
    idNumber: document.getElementById('editIdNumber').value,
    birthDate: document.getElementById('editBirthDate').value,
    phoneNumber: document.getElementById('editPhoneNumber').value,
    note: document.getElementById('editNote').value,
    hasVisa: isHasVisaChecked,
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
    showLoadingOverlay();
    await updateDoc(doc(db, "orders", id), updatedOrder);

    if (oldCvTitle && oldCvTitle !== newCvTitle) {
      const oldCvQ = query(collection(db, "cvs"), where("title", "==", oldCvTitle));
      const oldCvSnap = await getDocs(oldCvQ);
      const reactivateOld = oldCvSnap.docs.map(d => updateDoc(doc(db, "cvs", d.id), { status: "نشط" }));

      const newCvQ = query(collection(db, "cvs"), where("title", "==", newCvTitle));
      const newCvSnap = await getDocs(newCvQ);
      const archiveNew = newCvSnap.docs.map(d => updateDoc(doc(db, "cvs", d.id), { status: "جاري التعامل" }));

      await Promise.all([...reactivateOld, ...archiveNew]);
    } else if (newCvTitle) {
      const newCvQ = query(collection(db, "cvs"), where("title", "==", newCvTitle));
      const newCvSnap = await getDocs(newCvQ);
      const archiveNew = newCvSnap.docs.map(d => updateDoc(doc(db, "cvs", d.id), { status: "جاري التعامل" }));
      await Promise.all(archiveNew);
    }

    alert("تم تعديل كافة بيانات الطلب والتأشيرة بنجاح!");
    closeOrderEditModal();
    await loadOrders(ordersPage);
    await loadCvs();
  } catch(err) {
    console.error("خطأ التعديل:", err);
    alert("حدث خطأ أثناء تعديل الطلب.");
  } finally {
    hideLoadingOverlay();
  }
});

// 🔹 1 - تعديل قبول الطلب ليصبح "جاري التعامل" للسيفي والطلب
window.acceptOrder = async function(id, selectedItemTitle) {
  try {
    const orderRef = doc(db, "orders", id);
    const acceptTimestamp = new Date().toISOString();

    const orderDocSnap = await getDoc(orderRef);
    const orderData = orderDocSnap.exists() ? orderDocSnap.data() : {};

    await updateDoc(orderRef, {
      status: "مقبول",
      acceptedAt: acceptTimestamp,
      trackingStatus: systemStatuses[0] || "تحت الإجراء"
    });

    if (selectedItemTitle) {
      const cvQuery = query(collection(db, "cvs"), where("title", "==", selectedItemTitle));
      const cvSnapshot = await getDocs(cvQuery);
      const cvFinishedUpdates = cvSnapshot.docs.map(cvDoc => 
        updateDoc(doc(db, "cvs", cvDoc.id), { status: "جاري التعامل" })
      );
      await Promise.all(cvFinishedUpdates);
    }

    await sendTelegramAcceptNotification({ id, ...orderData, selectedItem: selectedItemTitle });

    alert("تم قبول الطلب ونقله إلى قسم المتابعة بنجاح! وتغيير حالة السيفي إلى (جاري التعامل).");
    loadOrders(ordersPage);
    loadTracking();
    loadCvs();
  } catch (err) {
    console.error("خطأ أثناء قبول الطلب:", err);
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
    loadOrders(ordersPage);
    loadTracking();
    loadCvs();
  }
};

// 6. قسم المتابعة (10 نتائج للصفحة)
let allTrackingData = [];
async function loadTracking(page = 1) {
  trackingPage = page;
  const tbody = document.getElementById('trackingTableBody');
  if (!tbody) return;

  const q = query(collection(db, "orders"), where("status", "==", "مقبول"));
  const querySnapshot = await getDocs(q);
  allTrackingData = [];

  querySnapshot.forEach(docSnap => {
    allTrackingData.push({ id: docSnap.id, ...docSnap.data() });
  });

  // فرز الطلبات يدويًا من الأحدث إلى الأقدم
  allTrackingData.sort((a, b) => {
    const dateA = new Date(a.acceptedAt || a.createdAtIso || a.createdAt || 0);
    const dateB = new Date(b.acceptedAt || b.createdAtIso || b.createdAt || 0);
    return dateB - dateA;
  });

  const trackingCountElem = document.getElementById('trackingOrdersCount');
  if (trackingCountElem) trackingCountElem.textContent = allTrackingData.length;

  if (allTrackingData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7">لا توجد طلبات جارية تحت المتابعة</td></tr>';
    renderCustomPagination('trackingPagination', 0, 1, 'changeTrackingPage');
    return;
  }

  const startIndex = (trackingPage - 1) * PAGE_SIZE_10;
  const pageData = allTrackingData.slice(startIndex, startIndex + PAGE_SIZE_10);
  
  // (باقي كود رسم الجدول كما هو بدون تغيير...)
  // ...
  const now = new Date();

  const rows = pageData.map(item => {
    const id = item.id;
    let daysDiff = 0;

    const parseSafeDate = (dateStr) => {
      if (!dateStr) return null;
      if (typeof dateStr !== 'string') return new Date(dateStr);
      const westernNumbers = dateStr.replace(/[٠-٩]/g, d => "٠١٢٣٥٦٧٨٩".indexOf(d));
      const d = new Date(westernNumbers);
      return isNaN(d.getTime()) ? null : d;
    };

    const acceptDate = parseSafeDate(item.acceptedAt) || parseSafeDate(item.createdAtIso) || parseSafeDate(item.createdAt) || new Date();
    const diffTime = Math.abs(now - acceptDate);
    daysDiff = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    if (isNaN(daysDiff)) daysDiff = 0;

    let colorStyle = '#27ae60';
    if (daysDiff >= 31 && daysDiff <= 45) {
      colorStyle = '#f39c12';
    } else if (daysDiff >= 46) {
      colorStyle = '#e74c3c';
    }

    let optionsHTML = systemStatuses.map(st => `<option value="${st}" ${item.trackingStatus === st ? 'selected' : ''}>${st}</option>`).join('');

    const internalWorkerName = item.workerName || cvsMapCache[item.selectedItem] || '';
    const workerNameDisplay = internalWorkerName ? ` (${internalWorkerName})` : '';
    const safeTrackingData = JSON.stringify(item).replace(/"/g, '&quot;');

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
          <button class="btn-action btn-accept" onclick="completeOrder('${id}', '${item.selectedItem}')">إنهاء الطلب</button>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = rows.join('');
  renderCustomPagination('trackingPagination', allTrackingData.length, trackingPage, 'changeTrackingPage');
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

window.changeTrackingPage = function(p) { loadTracking(p); };

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
    showLoadingOverlay();
    await updateDoc(doc(db, "orders", id), {
      trackingStatus: trackingStatus,
      trackingDetails: trackingDetails
    });

    alert("تم حفظ بيانات المتابعة بنجاح!");
    closeTrackingEditModal();
    loadTracking(trackingPage);
  } catch(err) {
    console.error("خطأ في المتابعة:", err);
    alert("حدث خطأ أثناء حفظ بيانات المتابعة.");
  } finally {
    hideLoadingOverlay();
  }
});

// 🔹 1 - تعديل إنهاء الطلب ليصبح "تم الانتهاء" للسيفي
window.completeOrder = async function(id, selectedItemTitle) {
  if (confirm("هل أنت متأكد من إنهاء هذا الطلب ونقله إلى الأرشيف؟")) {
    try {
      const orderRef = doc(db, "orders", id);
      await updateDoc(orderRef, {
        status: "مؤرشف",
        trackingStatus: "مكتمل ومؤرشف"
      });

      if (selectedItemTitle) {
        const cvQuery = query(collection(db, "cvs"), where("title", "==", selectedItemTitle));
        const cvSnapshot = await getDocs(cvQuery);
        const cvFinishedUpdates = cvSnapshot.docs.map(cvDoc => 
          updateDoc(doc(db, "cvs", cvDoc.id), { status: "تم الانتهاء" })
        );
        await Promise.all(cvFinishedUpdates);
      }

      alert("تم إنهاء الطلب ونقله إلى الأرشيف بنجاح وتعديل حالة السيفي إلى (تم الانتهاء)!");
      loadTracking(trackingPage);
      loadArchive(archivePage);
      loadCvs();
      calculateAnalytics();
    } catch (err) {
      console.error("خطأ أثناء إنهاء الطلب:", err);
      alert("حدث خطأ: " + err.message);
    }
  }
};

window.updateTrackingStatus = async function(id, newStatus) {
  await updateDoc(doc(db, "orders", id), { trackingStatus: newStatus });
  loadTracking(trackingPage);
};


// 7. قسم الأرشيف (10 نتائج للصفحة)
let allArchiveData = [];
async function loadArchive(page = 1) {
  archivePage = page;
  const tbody = document.getElementById('archiveTableBody');
  if (!tbody) return;

  const q = query(collection(db, "orders"), where("status", "==", "مؤرشف"));
  const querySnapshot = await getDocs(q);
  allArchiveData = [];

  querySnapshot.forEach(docSnap => {
    allArchiveData.push({ id: docSnap.id, ...docSnap.data() });
  });

  // فرز الأرشيف من الأحدث إلى الأقدم
  allArchiveData.sort((a, b) => {
    const dateA = new Date(a.updatedAt || a.createdAtIso || a.createdAt || 0);
    const dateB = new Date(b.updatedAt || b.createdAtIso || b.createdAt || 0);
    return dateB - dateA;
  });

  const archiveCountElem = document.getElementById('archiveCount');
  if (archiveCountElem) archiveCountElem.textContent = allArchiveData.length;

  if (allArchiveData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">الأرشيف فارغ حالياً</td></tr>';
    renderCustomPagination('archivePagination', 0, 1, 'changeArchivePage');
    return;
  }

  const startIndex = (archivePage - 1) * PAGE_SIZE_10;
  const pageData = allArchiveData.slice(startIndex, startIndex + PAGE_SIZE_10);

  tbody.innerHTML = pageData.map(item => {
    const safeOrderData = JSON.stringify(item).replace(/"/g, '&quot;');
    return `
      <tr>
        <td>${item.applicantName || '-'}</td>
        <td>${item.selectedItem || '-'}</td>
        <td>${item.phoneNumber || '-'}</td>
        <td><span style="color:#27ae60; font-weight:bold;">${item.trackingStatus || 'مكتمل ومؤرشف'}</span></td>
        <td>${item.createdAt || '-'}</td>
        <td>
          <button class="btn-action btn-edit" onclick="openOrderEditModal(${safeOrderData})">تعديل</button>
        </td>
      </tr>
    `;
  }).join('');

  renderCustomPagination('archivePagination', allArchiveData.length, archivePage, 'changeArchivePage');
}

window.changeArchivePage = function(p) { loadArchive(p); };

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
  }
});

// 9. السير الذاتية (قوائم مجزأة لـ 10 عناصر للصفحة)
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

let allArchiveCvsData = [];

// 🔹 2 - السيفيات المحدثة وتصفية الأرشيف لتعرض المؤرشفة / جاري التعامل / تم الانتهاء
async function loadCvs(cPage = 1, aPage = 1) {
  cvsPage = cPage;
  cvArchivePage = aPage;

  const querySnapshot = await getDocs(collection(db, "cvs"));
  allCvsData = [];
  allArchiveCvsData = [];
  cvsMapCache = {};
  let active = 0;

  querySnapshot.forEach((docSnap) => {
    const item = docSnap.data();
    const id = docSnap.id;
    cvsMapCache[item.title] = item.workerName || '';

    if (item.status === 'نشط') {
      active++;
      allCvsData.push({ id, ...item });
    } else {
      // إظهار غير النشط في قسم الأرشيف
      allArchiveCvsData.push({ id, ...item });
    }
  });

  const activeCvsElem = document.getElementById('activeCvsCount');
  if (activeCvsElem) activeCvsElem.textContent = active;

  renderCvsTable(allCvsData);
  renderArchiveCvsTable(allArchiveCvsData);
}

function renderCvsTable(dataList) {
  const tbody = document.getElementById('cvsTableBody');
  if (!tbody) return;

  if (dataList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9">لا توجد سير ذاتية مطابقة</td></tr>';
    renderCustomPagination('cvsPagination', 0, 1, 'changeCvsPage');
    return;
  }

  const startIndex = (cvsPage - 1) * PAGE_SIZE_10;
  const pageData = dataList.slice(startIndex, startIndex + PAGE_SIZE_10);

  tbody.innerHTML = pageData.map((item) => {
    const safeData = JSON.stringify(item).replace(/"/g, '&quot;');
    return `
      <tr>
        <td>
          <img src="${item.imageUrl || 'https://via.placeholder.com/40'}" 
               onclick="viewCvImage('${item.title}')" 
               style="width:40px;height:40px;border-radius:50%;object-fit:cover;cursor:pointer;" 
               title="اضغط للتكبير">
        </td>
        <td>
          <a href="javascript:void(0)" onclick="viewCvImage('${item.title}')" style="font-weight:bold; color:var(--primary-blue); text-decoration:underline;">
            ${item.title}
          </a>
        </td>
        <td><strong>${item.job || 'عاملة منزلية'}</strong></td>
        <td>${item.serviceType || 'إستقدام جديد'}</td>
        <td><strong style="color:#b38b4d;">${item.workerName || 'غير محدد'}</strong></td>
        <td><span style="background:#f1f5f9; padding:3px 8px; border-radius:6px; font-weight:bold; font-size:11px;">${item.officeName || 'غير محدد'}</span></td>
        <td>${item.country}</td>
        <td><span style="background:#e8f8f5; color:#27ae60; padding:3px 8px; border-radius:6px; font-weight:bold;">${item.status}</span></td>
        <td>
          <button class="btn-action btn-edit" onclick="openEditCvModal(${safeData})">تعديل</button>
          <button class="btn-action btn-archive" onclick="toggleArchive('${item.id}', '${item.status}')">${item.status === 'نشط' ? 'أرشفة' : 'تفعيل'}</button>
          <button class="btn-action btn-delete" onclick="deleteCv('${item.id}')">حذف</button>
        </td>
      </tr>
    `;
  }).join('');

  renderCustomPagination('cvsPagination', dataList.length, cvsPage, 'changeCvsPage');
}

window.changeCvsPage = function(p) {
  cvsPage = p;
  renderCvsTable(allCvsData);
};

function renderArchiveCvsTable(dataList) {
  const tbody = document.getElementById('cvArchiveTableBody');
  if (!tbody) return;

  if (dataList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9">لا توجد سير ذاتية في الأرشيف حالياً</td></tr>';
    renderCustomPagination('cvArchivePagination', 0, 1, 'changeCvArchivePage');
    return;
  }

  const startIndex = (cvArchivePage - 1) * PAGE_SIZE_10;
  const pageData = dataList.slice(startIndex, startIndex + PAGE_SIZE_10);

  tbody.innerHTML = pageData.map((item) => {
    let statusBg = '#ffeaa7', statusColor = '#d63031';
    if (item.status === 'جاري التعامل') {
      statusBg = '#e1f5fe'; statusColor = '#0288d1';
    } else if (item.status === 'تم الانتهاء') {
      statusBg = '#e8f5e9'; statusColor = '#2e7d32';
    }

    return `
      <tr>
        <td>
          <img src="${item.imageUrl || 'https://via.placeholder.com/40'}" 
               onclick="viewCvImage('${item.title}')" 
               style="width:40px;height:40px;border-radius:50%;object-fit:cover;cursor:pointer;" 
               title="اضغط للتكبير">
        </td>
        <td>
          <a href="javascript:void(0)" onclick="viewCvImage('${item.title}')" style="font-weight:bold; color:var(--primary-blue); text-decoration:underline;">
            ${item.title}
          </a>
        </td>
        <td><strong>${item.job || 'عاملة منزلية'}</strong></td>
        <td>${item.serviceType || 'إستقدام جديد'}</td>
        <td><strong style="color:#b38b4d;">${item.workerName || 'غير محدد'}</strong></td>
        <td><span style="background:#f1f5f9; padding:3px 8px; border-radius:6px; font-weight:bold; font-size:11px;">${item.officeName || 'غير محدد'}</span></td>
        <td>${item.country}</td>
        <td><span style="background:${statusBg}; color:${statusColor}; padding:3px 8px; border-radius:6px; font-weight:bold;">${item.status}</span></td>
        <td>
          <button class="btn-action btn-accept" onclick="reactivateCv('${item.id}')">إعادة تفعيل 🔄</button>
          <button class="btn-action btn-delete" onclick="deleteCv('${item.id}')">حذف</button>
        </td>
      </tr>
    `;
  }).join('');

  renderCustomPagination('cvArchivePagination', dataList.length, cvArchivePage, 'changeCvArchivePage');
}

window.reactivateCv = async function(id) {
  try {
    await updateDoc(doc(db, "cvs", id), { status: "نشط" });
    alert("تمت إعادة تفعيل السيرة الذاتية بنجاح ونقلها للقائمة الرئيسية!");
    await loadCvs();
  } catch (err) {
    console.error("خطأ أثناء إعادة تفعيل السيفي:", err);
    alert("حدث خطأ أثناء محاولة إعادة التفعيل.");
  }
};

window.changeCvArchivePage = function(p) {
  cvArchivePage = p;
  renderArchiveCvsTable(allArchiveCvsData);
};

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

    cvsPage = 1;
    renderCvsTable(filtered);
  }

  if (searchInput) searchInput.addEventListener('input', applyFilters);
  if (countryFilter) countryFilter.addEventListener('change', applyFilters);
  if (jobFilter) jobFilter.addEventListener('change', applyFilters);
  if (serviceFilter) serviceFilter.addEventListener('change', applyFilters);
}

// 🔹 2 - إعداد فلاتر أرشيف السيفيات مع خيار مؤرشف ونشط والجنسيات
function setupCvArchiveSearchAndFilters() {
  const searchInput = document.getElementById('cvArchiveSearchInput');
  const statusFilter = document.getElementById('cvArchiveFilterStatus');
  const countryFilter = document.getElementById('cvArchiveFilterCountry');
  const jobFilter = document.getElementById('cvArchiveFilterJob');

  function applyArchiveFilters() {
    const term = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const selectedStatus = statusFilter ? statusFilter.value : '';
    const selectedCountry = countryFilter ? countryFilter.value : '';
    const selectedJob = jobFilter ? jobFilter.value : '';

    const filtered = allArchiveCvsData.filter(item => {
      const matchesSearch = !term || 
        (item.workerName || '').toLowerCase().includes(term) ||
        (item.title || '').toLowerCase().includes(term) ||
        (item.country || '').toLowerCase().includes(term);

      const matchesStatus = !selectedStatus || item.status === selectedStatus;
      const matchesCountry = !selectedCountry || item.country === selectedCountry;
      const matchesJob = !selectedJob || item.job === selectedJob;

      return matchesSearch && matchesStatus && matchesCountry && matchesJob;
    });

    cvArchivePage = 1;
    renderArchiveCvsTable(filtered);
  }

  if (searchInput) searchInput.addEventListener('input', applyArchiveFilters);
  if (statusFilter) statusFilter.addEventListener('change', applyArchiveFilters);
  if (countryFilter) countryFilter.addEventListener('change', applyArchiveFilters);
  if (jobFilter) jobFilter.addEventListener('change', applyArchiveFilters);
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

  if (fileInput && fileInput.files[0]) {
    updateData.imageUrl = await convertBase64AndCompress(fileInput.files[0]);
  }

  try {
    showLoadingOverlay();
    await updateDoc(doc(db, "cvs", id), updateData);
    alert("تم تعديل بيانات السيرة الذاتية بنجاح!");
    closeEditCvModal();
    loadCvs(cvsPage, cvArchivePage);
  } catch (err) {
    console.error("خطأ أثناء التعديل:", err);
    alert("حدث خطأ أثناء حفظ التعديلات: " + err.message);
  } finally {
    hideLoadingOverlay();
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

// 🔹 فتح الصورة مكبرة مع توفير رابط فتح في تبويب جديد (Open Image in new tab)
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

    const modalImg = document.getElementById('dashboardCvModalImg');
    const newTabBtn = document.getElementById('dashboardCvOpenNewTabBtn');
    const modal = document.getElementById('dashboardCvModal');
    
    if (modalImg && modal) {
      modalImg.src = imageUrl;
      if (newTabBtn) newTabBtn.href = imageUrl;
      modal.style.display = 'flex';
    }
  } catch (err) {
    console.error("خطأ أثناء جلب السيرة الذاتية:", err);
  }
};

window.closeDashboardCvModal = function() {
  const modal = document.getElementById('dashboardCvModal');
  if (modal) modal.style.display = 'none';
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

document.getElementById('permissionsForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const userId = document.getElementById('permUserId').value;
  
  const selectedPermissions = [];
  document.querySelectorAll('#permissionsCheckboxesGroup input[type="checkbox"]:checked').forEach(cb => {
    selectedPermissions.push(cb.value);
  });

  try {
    await updateDoc(doc(db, "users", userId), { permissions: selectedPermissions });
    alert("تم حفظ وتحديث صلاحيات الحساب بنجاح!");
    closePermissionsModal();
    loadUsers();
  } catch (err) {
    console.error("خطأ حفظ الصلاحيات:", err);
  }
});

async function applyUserPermissions(userEmail) {
  try {
    const q = query(collection(db, "users"), where("email", "==", userEmail));
    const snap = await getDocs(q);
    
    if (!snap.empty) {
      const userData = snap.docs[0].data();
      const perms = userData.permissions || [];

      if (userData.role === 'admin' || perms.includes('*')) return;

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

      document.querySelectorAll('.tab-content').forEach(tab => {
        if (!perms.includes(tab.id)) {
          tab.classList.remove('active');
          tab.style.display = 'none';
        }
      });

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

function setupDashboardSearchFilters() {
  const ordersSearch = document.getElementById('ordersSearchInput');
  if (ordersSearch) {
    ordersSearch.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase().trim();
      const filtered = allOrdersData.filter(o => 
        (o.applicantName || '').toLowerCase().includes(term) ||
        (o.selectedItem || '').toLowerCase().includes(term) ||
        (o.phoneNumber || '').toLowerCase().includes(term)
      );
      ordersPage = 1;
      const tbody = document.getElementById('ordersTableBody');
      if (!tbody) return;
      if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6">لا توجد نتائج مطابقة للبحث</td></tr>';
        renderCustomPagination('ordersPagination', 0, 1, 'changeOrdersPage');
        return;
      }
    });
  }

  const trackingSearch = document.getElementById('trackingSearchInput');
  if (trackingSearch) {
    trackingSearch.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase().trim();
      document.querySelectorAll('#trackingTableBody tr').forEach(row => {
        row.style.display = row.textContent.toLowerCase().includes(term) ? '' : 'none';
      });
    });
  }

  const archiveSearch = document.getElementById('archiveSearchInput');
  if (archiveSearch) {
    archiveSearch.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase().trim();
      document.querySelectorAll('#archiveTableBody tr').forEach(row => {
        row.style.display = row.textContent.toLowerCase().includes(term) ? '' : 'none';
      });
    });
  }
}

// ==========================================
// 11. إدارة الحضور والتحقق الجغرافي وبصمة الوجه المباشرة
// ==========================================

let activeWebcamStream = null;
let capturedFaceDataBase64 = null;
let currentScanType = 'check-in'; 
let liveScanWebcamStream = null;

function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;

  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("الموقع الجغرافي غير مدعوم في متصفحك"));
    } else {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      });
    }
  });
}

window.openAddFaceModal = async function() {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    alert("يرجى تسجيل الدخول أولاً!");
    return;
  }

  document.getElementById('addFaceModal').style.display = 'flex';
  document.getElementById('captureStatus').textContent = '';
  capturedFaceDataBase64 = null;

  // التحقق هل توجد بصمة مسجلة لهذا الحساب مسبقاً
  try {
    const q = query(collection(db, "employeeBiometrics"), where("userEmail", "==", currentUser.email));
    const snap = await getDocs(q);

    const submitBtn = document.getElementById('submitFaceBtn');
    if (!snap.empty) {
      const existingData = snap.docs[0].data();
      document.getElementById('employeeNameInput').value = existingData.employeeName || '';
      document.getElementById('employeeIdInput').value = existingData.employeeId || '';
      if (submitBtn) submitBtn.textContent = "🔄 تجديد بصمة الوجه";
    } else {
      document.getElementById('employeeNameInput').value = '';
      document.getElementById('employeeIdInput').value = '';
      if (submitBtn) submitBtn.textContent = "➕ إضافة بصمة وجه موظف";
    }
  } catch (err) {
    console.error("خطأ في جلب بيانات البصمة:", err);
  }

  await startWebcam('webcamVideo');
};

window.closeAddFaceModal = function() {
  document.getElementById('addFaceModal').style.display = 'none';
  stopWebcam(activeWebcamStream);
};

window.openScanCameraModal = async function(type) {
  currentScanType = type;
  const title = document.getElementById('scanModalTitle');
  if (title) title.textContent = type === 'check-in' ? '📷 مسح الوجه لالتقاط صورة الحضور' : '🚪 مسح الوجه لالتقاط صورة الانصراف';
  
  const statusDiv = document.getElementById('scanModalStatus');
  if (statusDiv) statusDiv.textContent = 'جاري التحقق من موقعك الكاميرا...';

  document.getElementById('scanCameraModal').style.display = 'flex';
  liveScanWebcamStream = await startWebcam('scanWebcamVideo');
};

window.closeScanCameraModal = function() {
  document.getElementById('scanCameraModal').style.display = 'none';
  if (liveScanWebcamStream) {
    liveScanWebcamStream.getTracks().forEach(t => t.stop());
    liveScanWebcamStream = null;
  }
};

async function startWebcam(videoId) {
  const video = document.getElementById(videoId);
  if (!video) return null;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ 
      video: { width: 640, height: 480, facingMode: "user" } 
    });
    video.srcObject = stream;
    if (videoId === 'webcamVideo') activeWebcamStream = stream;
    return stream;
  } catch (err) {
    console.error("خطأ تشغيل الكاميرا:", err);
    alert("تعذر الوصول للكاميرا. يرجى التأكد من السماح بالصلاحية.");
    return null;
  }
}

function stopWebcam(stream) {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
  }
}

window.captureFaceSnapshot = function() {
  const video = document.getElementById('webcamVideo');
  const canvas = document.getElementById('faceCanvas');
  const statusDiv = document.getElementById('captureStatus');

  if (!video) return;

  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  capturedFaceDataBase64 = canvas.toDataURL('image/jpeg', 0.85);
  statusDiv.textContent = "✅ تم التقاط صورة الوجه الأساسية بنجاح!";
};

document.getElementById('addFaceForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!capturedFaceDataBase64) {
    alert("يرجى التقاط صورة الوجه أولاً قبل الحفظ!");
    return;
  }

  const currentUser = auth.currentUser;
  const name = document.getElementById('employeeNameInput').value;
  const empId = document.getElementById('employeeIdInput').value;

  try {
    showLoadingOverlay();
    const position = await getCurrentLocation();

    // البحث عن وجود بصمة سابقة لتحديثها (تجديدها) بدلاً من إنشاء مستند جديد
    const q = query(collection(db, "employeeBiometrics"), where("userEmail", "==", currentUser.email));
    const snap = await getDocs(q);

    const payload = {
      userEmail: currentUser.email,
      employeeId: empId,
      employeeName: name,
      faceVectorData: capturedFaceDataBase64,
      registeredLocation: {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      },
      updatedAt: new Date().toISOString()
    };

    if (!snap.empty) {
      // تجديد البصمة القائمة
      const docId = snap.docs[0].id;
      await updateDoc(doc(db, "employeeBiometrics", docId), payload);
      alert("تم تجديد بصمة الوجه والموقع الجغرافي للموظف بنجاح!");
    } else {
      // إضافة بصمة لأول مرة
      payload.createdAt = new Date().toISOString();
      await addDoc(collection(db, "employeeBiometrics"), payload);
      alert("تمت إضافة بصمة الوجه والموقع الجغرافي للموظف بنجاح!");
    }

    closeAddFaceModal();
  } catch (err) {
    console.error("خطأ حفظ البصمة:", err);
    alert("حدث خطأ أثناء الحفظ: " + err.message);
  } finally {
    hideLoadingOverlay();
  }
});

window.submitAttendanceWithLiveScan = async function() {
  const video = document.getElementById('scanWebcamVideo');
  const canvas = document.getElementById('scanFaceCanvas');
  const statusDiv = document.getElementById('scanModalStatus');

  if (!video) return;

  try {
    statusDiv.style.color = '#1c5276';
    statusDiv.textContent = "⌛ جاري التأكد من الموقع الجغرافي وتجهيز الكاميرا...";

    const position = await getCurrentLocation();
    const userLat = position.coords.latitude;
    const userLng = position.coords.longitude;
    const distanceMeters = calculateDistanceMeters(OFFICE_LAT, OFFICE_LNG, userLat, userLng);

    if (distanceMeters > MAX_ALLOWED_DISTANCE_METERS) {
      statusDiv.style.color = '#d63031';
      statusDiv.textContent = `❌ أنت خارج نطاق المكتب! المسافة: ${Math.round(distanceMeters)} متر.`;
      alert(`عذراً، أنت بعيد عن المكتب بمسافة ${Math.round(distanceMeters)} متر.`);
      return;
    }

    statusDiv.textContent = "📸 جاري التقاط الصورة والتحقق من الوجه...";
    await new Promise(resolve => setTimeout(resolve, 1500));

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let totalBrightness = 0;
    for (let i = 0; i < imgData.data.length; i += 4) {
      totalBrightness += (imgData.data[i] + imgData.data[i+1] + imgData.data[i+2]) / 3;
    }
    const avgBrightness = totalBrightness / (imgData.data.length / 4);

    if (avgBrightness < 15) {
      statusDiv.style.color = '#d63031';
      statusDiv.textContent = "❌ الكاميرا مغطاة أو الإضاءة معدومة! يرجى إظهار وجهك بوضوح.";
      alert("تعذر التقاط الوجه! الشاشة سوداء أو الإضاءة منخفضة جداً.");
      return;
    }

    const liveCapturedFaceImage = canvas.toDataURL('image/jpeg', 0.85);
    showLoadingOverlay();

// ابحث عن الجزء الذي يستعلم فيه عن بصمة الموظف واجعله بالبريد الإلكتروني للحساب الحالي:
const currentUser = auth.currentUser;
const bioQ = query(collection(db, "employeeBiometrics"), where("userEmail", "==", currentUser.email));
const bioSnap = await getDocs(bioQ);

if (bioSnap.empty) {
  alert("لم يتم تسجيل بصمة وجه لهذا الحساب بعد! يرجى إضافة بصمة الوجه أولاً.");
  closeScanCameraModal();
  return;
}

const matchedEmp = bioSnap.docs[0].data();

await addDoc(collection(db, "attendanceLogs"), {
  userEmail: currentUser.email,
  employeeName: matchedEmp.employeeName || currentUser.email,
  employeeId: matchedEmp.employeeId || '-',
  type: currentScanType === 'check-in' ? 'حضور' : 'انصراف',
  timestamp: new Date().toLocaleString('ar-SA'),
  createdAtIso: new Date().toISOString(), // للترتيب الصحيح لاحقاً
  location: { latitude: userLat, longitude: userLng },
  distanceMeters: Math.round(distanceMeters),
  matched: true,
  faceSnapshot: liveCapturedFaceImage
});

    alert(`✅ تم تسجيل ${currentScanType === 'check-in' ? 'الحضور' : 'الانصراف'} بنجاح وبصورة حية واضحة!`);
    closeScanCameraModal();
    await loadAttendanceLogs();

  } catch (err) {
    console.error("خطأ التحضير الحي:", err);
    alert("حدث خطأ أثناء التحضير: " + err.message);
  } finally {
    hideLoadingOverlay();
  }
};

async function loadAttendanceLogs() {
  const tbody = document.getElementById('attendanceLogsTableBody');
  if (!tbody) return;

  try {
    const q = query(collection(db, "attendanceLogs"), orderBy("timestamp", "desc"), limit(10));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      tbody.innerHTML = '<tr><td colspan="6">لا توجد سجلات حضور مسجلة حالياً</td></tr>';
      return;
    }

    tbody.innerHTML = querySnapshot.docs.map(docSnap => {
      const item = docSnap.data();
      const loc = item.location || {};
      const mapLink = loc.latitude ? `https://maps.google.com/?q=${loc.latitude},${loc.longitude}` : '#';

      return `
        <tr>
          <td><img src="${item.faceSnapshot || 'https://via.placeholder.com/40'}" style="width:45px; height:45px; border-radius:50%; object-fit:cover; border:2px solid var(--primary-blue);"></td>
          <td><strong>${item.employeeName}</strong> <br><small style="color:#777;">(${item.employeeId})</small></td>
          <td><span style="background:${item.type === 'حضور' ? '#e8f8f5' : '#fdedec'}; color:${item.type === 'حضور' ? '#27ae60' : '#e74c3c'}; padding:4px 8px; border-radius:6px; font-weight:bold;">${item.type}</span></td>
          <td>${item.timestamp}</td>
          <td>
            <a href="${mapLink}" target="_blank" style="color:var(--primary-blue); font-weight:bold;">📍 الخريطة</a>
            <br><small style="color:#777;">(${item.distanceMeters || 0} متر عن المكتب)</small>
          </td>
          <td><span style="color:#27ae60; font-weight:bold;">✅ صورة حية مطابقة</span></td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error("خطأ تحميل سجل الحضور:", err);
  }
}

// دالة فتح وإغلاق أقسام القائمة الجانبية
window.toggleNavGroup = function(headerElem) {
  const navGroup = headerElem.nextElementSibling;
  if (!navGroup) return;

  headerElem.classList.toggle('collapsed');
  navGroup.classList.toggle('is-closed');
};