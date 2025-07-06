import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, BarChart, Bar } from 'recharts';
import { Plus, Trash2, Download, BarChart3, TrendingUp, FilePlus, Loader, AlertTriangle, History, ArrowLeft, FlaskConical } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { getAuth, signInWithCustomToken, signInAnonymously } from 'firebase/auth';

// --- Firebase Configuration ---
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// --- Helper Functions for Statistical Calculations ---
const calculateSkewness = (values, mean, stdDev) => {
    if (stdDev === 0) return 0;
    const n = values.length;
    const sum = values.reduce((acc, val) => acc + Math.pow((val - mean) / stdDev, 3), 0);
    return sum / n;
};

const calculateKurtosis = (values, mean, stdDev) => {
    if (stdDev === 0) return 0;
    const n = values.length;
    const sum = values.reduce((acc, val) => acc + Math.pow((val - mean) / stdDev, 4), 0);
    return (sum / n) - 3;
};

const createHistogram = (values) => {
    if (values.length < 3) return [];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    const numBins = Math.ceil(Math.log2(values.length) + 1);
    const binWidth = range > 0 ? range / numBins : 1;
    const bins = [];
    for (let i = 0; i < numBins; i++) {
      const binStart = min + i * binWidth;
      const binEnd = binStart + binWidth;
      const count = values.filter(v => v >= binStart && (i === numBins - 1 ? v <= binEnd : v < binEnd)).length;
      bins.push({ bin: `${binStart.toFixed(2)}-${binEnd.toFixed(2)}`, count });
    }
    return bins;
};


// --- Data Structures ---
const createNewChart = (name, inheritedStats = null) => ({
  id: Date.now(),
  name: name,
  materialInfo: { name: '', lote: '', certifiedValue: '', uncertainty: '', unit: '', method: '' },
  data: [],
  analystsList: [],
  stats: { mean: 0, stdDev: 0, ucl: 0, lcl: 0, uwl: 0, lwl: 0, count: 0, domain: ['auto', 'auto'] },
  inheritedStats: inheritedStats,
  alerts: [],
  histogramData: [],
  normalityTests: { skewness: 0, kurtosis: 0, isNormal: null, isSkewnessNormal: null, isKurtosisNormal: null },
});

const createNewProcessGroup = (name) => ({
    id: Date.now(),
    name: name,
    charts: [],
});

// --- Main App Component ---
const App = () => {
    const [processGroups, setProcessGroups] = useState([]);
    const [activeProcessGroupId, setActiveProcessGroupId] = useState(null);
    const [auditLog, setAuditLog] = useState([]);
    const [db, setDb] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    // --- Firebase & Data Management ---
    useEffect(() => {
        try {
            const app = initializeApp(firebaseConfig);
            const firestore = getFirestore(app);
            const auth = getAuth(app);
            setDb(firestore);

            const authenticateAndLoad = async () => {
                try {
                    if (initialAuthToken) {
                        await signInWithCustomToken(auth, initialAuthToken);
                    } else {
                        await signInAnonymously(auth);
                    }
                    const user = auth.currentUser;
                    if (user) {
                        setUserId(user.uid);
                        const docRef = doc(firestore, `artifacts/${appId}/users/${user.uid}/mrc-control-charts`, 'data');
                        const docSnap = await getDoc(docRef);
                        if (docSnap.exists()) {
                            const loadedData = docSnap.data();
                            setProcessGroups(loadedData.processGroups || []);
                            setAuditLog(loadedData.auditLog || []);
                            // FIX: Load the last active process ID
                            if (loadedData.activeProcessGroupId) {
                                setActiveProcessGroupId(loadedData.activeProcessGroupId);
                            }
                        }
                    }
                } catch (error) {
                    console.error("Authentication or data loading failed:", error);
                } finally {
                    setIsLoading(false);
                }
            };
            authenticateAndLoad();
        } catch (error) {
            console.error("Firebase initialization failed:", error);
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (isLoading) return;
        const saveData = async () => {
            if (!db || !userId) return;
            try {
                const docRef = doc(db, `artifacts/${appId}/users/${userId}/mrc-control-charts`, 'data');
                // FIX: Save the activeProcessGroupId along with other data
                await setDoc(docRef, { processGroups, auditLog, activeProcessGroupId });
            } catch (error) {
                console.error("Error saving data to Firestore:", error);
            }
        };
        const handler = setTimeout(() => { saveData(); }, 1500);
        return () => clearTimeout(handler);
    }, [processGroups, auditLog, activeProcessGroupId, db, userId, isLoading]);

    // --- UI Rendering Logic ---
    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
                <Loader className="w-16 h-16 text-blue-600 animate-spin mb-4" />
                <p className="text-gray-700 text-lg">Cargando datos...</p>
            </div>
        );
    }

    if (activeProcessGroupId) {
        const activeProcessGroup = processGroups.find(p => p.id === activeProcessGroupId);
        const activeProcessGroupIndex = processGroups.findIndex(p => p.id === activeProcessGroupId);

        const updateProcessGroup = (updatedGroup) => {
            const newProcessGroups = [...processGroups];
            newProcessGroups[activeProcessGroupIndex] = updatedGroup;
            setProcessGroups(newProcessGroups);
        };

        return <ChartManager 
                    processGroup={activeProcessGroup} 
                    updateProcessGroup={updateProcessGroup}
                    goBack={() => setActiveProcessGroupId(null)} 
                    auditLog={auditLog}
                    setAuditLog={setAuditLog}
                />;
    }

    return <ProcessDashboard 
                processGroups={processGroups} 
                setProcessGroups={setProcessGroups} 
                setActiveProcessGroupId={setActiveProcessGroupId}
                setAuditLog={setAuditLog} 
            />;
};

// --- Process Dashboard Component ---
const ProcessDashboard = ({ processGroups, setProcessGroups, setActiveProcessGroupId, setAuditLog }) => {
    const [newProcessName, setNewProcessName] = useState('');

    const handleAddProcess = () => {
        if (newProcessName.trim()) {
            const newProcess = createNewProcessGroup(newProcessName.trim());
            setProcessGroups(prev => [...prev, newProcess]);
            setAuditLog(prev => [{
                id: Date.now(),
                timestamp: new Date().toISOString(),
                action: 'CREATE_PROCESS',
                details: { processName: newProcess.name }
            }, ...prev]);
            setNewProcessName('');
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 sm:p-8">
            <div className="max-w-4xl mx-auto">
                <div className="text-center mb-12">
                    <FlaskConical className="text-blue-500 w-24 h-24 mx-auto mb-4" />
                    <h1 className="text-4xl sm:text-5xl font-bold text-gray-800 mb-2">Panel de Procesos de Control</h1>
                    <p className="text-gray-600 text-lg">Seleccione un proceso para ver sus cartas de control o cree uno nuevo.</p>
                </div>

                <div className="bg-white p-6 rounded-xl shadow-md mb-8">
                    <h2 className="text-xl font-semibold mb-3">Crear Nuevo Proceso</h2>
                    <div className="flex gap-2">
                        <input 
                            type="text"
                            value={newProcessName}
                            onChange={(e) => setNewProcessName(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleAddProcess()}
                            placeholder="Ej: Densidad, Humedad, Viscosidad..."
                            className="flex-grow p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                        <button onClick={handleAddProcess} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2 disabled:bg-gray-400" disabled={!newProcessName.trim()}>
                            <FilePlus className="w-5 h-5" /> Crear
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {processGroups.map(group => (
                        <div key={group.id} onClick={() => setActiveProcessGroupId(group.id)} className="bg-white p-6 rounded-xl shadow-lg hover:shadow-2xl hover:-translate-y-1 transition-all duration-300 cursor-pointer flex flex-col justify-between">
                            <div>
                                <h3 className="text-2xl font-bold text-gray-800 mb-2">{group.name}</h3>
                                <p className="text-gray-500">{group.charts.length} carta(s) de control</p>
                            </div>
                            <button className="mt-4 w-full bg-blue-100 text-blue-800 font-semibold py-2 rounded-lg hover:bg-blue-200 transition-colors">
                                Abrir Proceso
                            </button>
                        </div>
                    ))}
                </div>
                 {processGroups.length === 0 && (
                    <div className="text-center py-12">
                        <p className="text-gray-500">No hay procesos creados. ¡Empiece creando el primero!</p>
                    </div>
                )}
            </div>
        </div>
    );
};


// --- Chart Manager Component (The main view we had before) ---
const ChartManager = ({ processGroup, updateProcessGroup, goBack, auditLog, setAuditLog }) => {
  const [currentChartId, setCurrentChartId] = useState(processGroup.charts.length > 0 ? processGroup.charts[0].id : null);
  const [newValue, setNewValue] = useState('');
  const [currentAnalyst, setCurrentAnalyst] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isAuditLogModalOpen, setIsAuditLogModalOpen] = useState(false);
  const [isReasonModalOpen, setIsReasonModalOpen] = useState(false);
  const [pointToDelete, setPointToDelete] = useState(null);
  const [deletionReason, setDeletionReason] = useState('');
  const [deletionApprover, setDeletionApprover] = useState('');

  const currentChart = processGroup.charts.find(c => c.id === currentChartId);
  const currentChartIndex = processGroup.charts.findIndex(c => c.id === currentChartId);

  // --- Functions to modify the current process group ---
  const updateCharts = (newCharts) => {
    updateProcessGroup({ ...processGroup, charts: newCharts });
  };
  
  const logAuditEvent = (action, details) => {
    const newLogEntry = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      analyst: currentAnalyst || 'Sistema',
      processId: processGroup.id,
      processName: processGroup.name,
      chartId: currentChartId,
      chartName: currentChart?.name || 'N/A',
      action,
      details,
    };
    setAuditLog(prevLog => [newLogEntry, ...prevLog]);
  };

  useEffect(() => {
    if (!currentChartId && processGroup.charts.length > 0) {
      setCurrentChartId(processGroup.charts[0].id);
    }
  }, [processGroup.charts, currentChartId]);

  // --- STATISTICAL CALCULATIONS AND ALERT DETECTION ---
  useEffect(() => {
    if (!currentChart || currentChart.data.length < 2) {
        if (currentChart && (currentChart.stats.count > 0 || currentChart.alerts.length > 0)) {
            const newCharts = [...processGroup.charts];
            newCharts[currentChartIndex] = {
                ...currentChart,
                stats: { ...createNewChart('').stats },
                alerts: [],
                histogramData: [],
                normalityTests: { ...createNewChart('').normalityTests }
            };
            updateCharts(newCharts);
        }
        return;
    }

    const values = currentChart.data.map(d => d.value);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.length > 1 ? values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (values.length - 1) : 0;
    const stdDev = Math.sqrt(variance);
    
    const ucl = mean + 3 * stdDev;
    const lcl = mean - 3 * stdDev;
    const uwl = mean + 2 * stdDev;
    const lwl = mean - 2 * stdDev;

    const displayStats = currentChart.inheritedStats || { ucl, lcl, mean };
    const allValuesOnChart = [...values, displayStats.ucl, displayStats.lcl];
    if (currentChart.materialInfo.certifiedValue && !isNaN(parseFloat(currentChart.materialInfo.certifiedValue))) {
        allValuesOnChart.push(parseFloat(currentChart.materialInfo.certifiedValue));
    }
    
    let chartMin = Math.min(...allValuesOnChart);
    let chartMax = Math.max(...allValuesOnChart);
    
    if (chartMin === chartMax) {
        const centerValue = chartMin;
        const padding = Math.abs(centerValue * 0.001) || 0.5; 
        chartMin -= padding;
        chartMax += padding;
    } else {
        const range = chartMax - chartMin;
        const padding = range * 0.15;
        chartMin -= padding;
        chartMax += padding;
    }

    const domain = [chartMin, chartMax];
    const newStats = { mean, stdDev, ucl, lcl, uwl, lwl, count: values.length, domain };
    const alertStats = currentChart.inheritedStats || newStats;

    const newAlerts = [];
    values.forEach((value, index) => {
      if (value > alertStats.ucl || value < alertStats.lcl) newAlerts.push({ type: 'critical', message: `Punto ${index + 1}: Fuera de límites de control (±3σ)` });
    });
    if (values.length >= 3) {
      for (let i = 2; i < values.length; i++) {
        const lastThree = [values[i - 2], values[i - 1], values[i]];
        const outOfWarningCount = lastThree.filter(v => v > alertStats.uwl || v < alertStats.lwl).length;
        if (outOfWarningCount >= 2) {
          const message = `Alerta (2 de 3): Puntos consecutivos fuera de ±2σ, terminando en el punto ${i + 1}`;
          if (!newAlerts.some(alert => alert.message === message)) newAlerts.push({ type: 'warning', message: message });
        }
      }
    }
    let consecutiveAbove = 0, consecutiveBelow = 0;
    for (let i = 0; i < values.length; i++) {
      if (values[i] > alertStats.mean) { consecutiveAbove++; consecutiveBelow = 0; }
      else if (values[i] < alertStats.mean) { consecutiveBelow++; consecutiveAbove = 0; }
      if (consecutiveAbove >= 7) {
        const message = `Tendencia (desplazamiento): 7+ puntos consecutivos por encima de la media, terminando en el punto ${i + 1}`;
        if (!newAlerts.some(alert => alert.message === message)) newAlerts.push({ type: 'trend', message: message });
        consecutiveAbove = 0;
      }
      if (consecutiveBelow >= 7) {
        const message = `Tendencia (desplazamiento): 7+ puntos consecutivos por debajo de la media, terminando en el punto ${i + 1}`;
        if (!newAlerts.some(alert => alert.message === message)) newAlerts.push({ type: 'trend', message: message });
        consecutiveBelow = 0;
      }
    }
    if (values.length >= 6) {
      for (let i = 5; i < values.length; i++) {
        const lastSix = values.slice(i - 5, i + 1);
        let isAscending = true;
        for (let j = 1; j < lastSix.length; j++) if (lastSix[j] <= lastSix[j - 1]) { isAscending = false; break; }
        if (isAscending) {
          const message = `Tendencia (deriva): 6 puntos consecutivos en ascenso, terminando en el punto ${i + 1}`;
          if (!newAlerts.some(alert => alert.message === message)) newAlerts.push({ type: 'trend', message: message });
        }
        let isDescending = true;
        for (let j = 1; j < lastSix.length; j++) if (lastSix[j] >= lastSix[j - 1]) { isDescending = false; break; }
        if (isDescending) {
          const message = `Tendencia (deriva): 6 puntos consecutivos en descenso, terminando en el punto ${i + 1}`;
          if (!newAlerts.some(alert => alert.message === message)) newAlerts.push({ type: 'trend', message: message });
        }
      }
    }

    let newNormalityTests = { ...createNewChart('').normalityTests };
    let newHistogramData = [];
    if (values.length >= 3) {
      newNormalityTests = {
        skewness: calculateSkewness(values, mean, stdDev),
        kurtosis: calculateKurtosis(values, mean, stdDev),
        isSkewnessNormal: Math.abs(calculateSkewness(values, mean, stdDev)) < 2,
        isKurtosisNormal: Math.abs(calculateKurtosis(values, mean, stdDev)) < 2,
        isNormal: Math.abs(calculateSkewness(values, mean, stdDev)) < 2 && Math.abs(calculateKurtosis(values, mean, stdDev)) < 2 && values.length >= 8,
      };
      newHistogramData = createHistogram(values);
    }

    const newCharts = [...processGroup.charts];
    newCharts[currentChartIndex] = { ...currentChart, stats: newStats, alerts: newAlerts, normalityTests: newNormalityTests, histogramData: newHistogramData };
    if(JSON.stringify(processGroup.charts) !== JSON.stringify(newCharts)) updateCharts(newCharts);
  }, [currentChart?.data, currentChart?.materialInfo.certifiedValue]);
  
  const handleAddChart = () => {
    const lastChart = processGroup.charts.length > 0 ? processGroup.charts[processGroup.charts.length - 1] : null;
    let inheritedStats = null;
    if (lastChart && lastChart.data.length >= 2) {
        inheritedStats = { ...lastChart.stats };
    }
    const newChart = createNewChart(`Carta de Control #${processGroup.charts.length + 1}`, inheritedStats);
    logAuditEvent('CREATE_CHART', { chartName: newChart.name, inherited: !!inheritedStats });
    updateCharts([...processGroup.charts, newChart]);
    setCurrentChartId(newChart.id);
  };
  
  const confirmDeleteChart = () => {
    logAuditEvent('DELETE_CHART', { chartName: currentChart.name });
    const remainingCharts = processGroup.charts.filter(c => c.id !== currentChartId);
    updateCharts(remainingCharts);
    setCurrentChartId(remainingCharts.length > 0 ? remainingCharts[0].id : null);
    setIsDeleteModalOpen(false);
  };

  const handleChartNameChange = (e) => {
    const oldName = currentChart.name;
    const newName = e.target.value;
    if (oldName !== newName) {
        logAuditEvent('RENAME_CHART', { from: oldName, to: newName });
        const newCharts = [...processGroup.charts];
        newCharts[currentChartIndex].name = newName;
        updateCharts(newCharts);
    }
  };

  const handleMaterialInfoChange = (e) => {
    const { name, value } = e.target;
    const oldValue = currentChart.materialInfo[name];
    if(oldValue !== value) {
        logAuditEvent('UPDATE_MRC_INFO', { field: name, from: oldValue, to: value });
        const newCharts = [...processGroup.charts];
        newCharts[currentChartIndex].materialInfo = { ...currentChart.materialInfo, [name]: value };
        updateCharts(newCharts);
    }
  };

  const addDataPoint = () => {
    if (currentChart.data.length >= 30) {
        alert("Se ha alcanzado el límite de 30 datos para esta carta.");
        return;
    }
    if (newValue && !isNaN(parseFloat(newValue)) && currentAnalyst.trim()) {
      const newPoint = {
        id: Date.now(),
        point: currentChart.data.length + 1,
        value: parseFloat(newValue),
        analyst: currentAnalyst.trim(),
        date: new Date().toLocaleDateString('es-CO'),
        time: new Date().toLocaleTimeString('es-CO'),
        lote: currentChart.materialInfo.lote,
      };
      logAuditEvent('ADD_DATA_POINT', { point: newPoint.point, value: newPoint.value, lote: newPoint.lote });
      const newCharts = [...processGroup.charts];
      const newData = [...currentChart.data, newPoint];
      let newAnalystsList = currentChart.analystsList;
      if (!newAnalystsList.includes(currentAnalyst.trim())) newAnalystsList = [...newAnalystsList, currentAnalyst.trim()];
      newCharts[currentChartIndex] = { ...currentChart, data: newData, analystsList: newAnalystsList };
      updateCharts(newCharts);
      setNewValue('');
    }
  };

  const startRemoveDataPoint = (id) => {
    setPointToDelete(id);
    setIsReasonModalOpen(true);
  };
  
  const confirmRemoveDataPoint = () => {
    if (!deletionReason.trim() || !deletionApprover.trim()) {
        alert("Por favor, complete todos los campos para la eliminación.");
        return;
    }
    const point = currentChart.data.find(p => p.id === pointToDelete);
    logAuditEvent('DELETE_DATA_POINT', { point: point.point, value: point.value, lote: point.lote, reason: deletionReason, approver: deletionApprover });
    const newCharts = [...processGroup.charts];
    const newData = currentChart.data.filter(d => d.id !== pointToDelete).map((d, index) => ({ ...d, point: index + 1 }));
    newCharts[currentChartIndex].data = newData;
    updateCharts(newCharts);
    setIsReasonModalOpen(false);
    setPointToDelete(null);
    setDeletionReason('');
    setDeletionApprover('');
  };

  const exportData = () => {
    const exportObj = { ...currentChart, auditLog: auditLog.filter(log => log.chartId === currentChartId) };
    const dataStr = JSON.stringify(exportObj, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = `MRC_${currentChart.name.replace(/ /g, '_') || 'control_chart'}_${new Date().toISOString().split('T')[0]}.json`;
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    document.body.appendChild(linkElement);
    linkElement.click();
    document.body.removeChild(linkElement);
  };
  
  if (!currentChart) {
      return (
          <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 text-center p-4">
              <h1 className="text-2xl font-bold mb-4">Proceso: {processGroup.name}</h1>
              <p className="text-gray-700 text-lg mb-6">No hay cartas de control para este proceso.</p>
              <button onClick={handleAddChart} className="bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 text-lg font-semibold shadow-lg">
                <FilePlus className="w-6 h-6" /> Crear Primera Carta
              </button>
              <button onClick={goBack} className="mt-8 text-blue-600 hover:underline flex items-center gap-2">
                <ArrowLeft className="w-4 h-4" /> Volver a Procesos
              </button>
          </div>
      );
  }

  const displayStats = currentChart.inheritedStats || currentChart.stats;
  const isDataEntryDisabled = currentChart.data.length >= 30;

  const chartData = currentChart.data.map(d => ({
    ...d,
    mean: displayStats.mean,
    ucl: displayStats.ucl,
    lcl: displayStats.lcl,
    uwl: displayStats.uwl,
    lwl: displayStats.lwl,
  })) || [];

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
          <div className="bg-white p-3 border border-gray-300 rounded shadow-lg text-sm">
              <p className="font-bold">{`Punto: ${label}`}</p>
              <p style={{ color: payload[0].color }}>{`Valor: ${data.value.toFixed(5)} ${currentChart.materialInfo.unit || ''}`}</p>
              <p className="text-gray-600">{`Analista: ${data.analyst}`}</p>
              <p className="text-gray-600">{`Lote: ${data.lote || 'N/A'}`}</p>
              <p className="text-gray-600">{`Fecha: ${data.date} - ${data.time}`}</p>
          </div>
      );
    }
    return null;
  };

  return (
    <>
      <DeleteConfirmationModal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} onConfirm={confirmDeleteChart} chartName={currentChart?.name} />
      <AuditLogModal isOpen={isAuditLogModalOpen} onClose={() => setIsAuditLogModalOpen(false)} auditLog={auditLog.filter(log => log.processId === processGroup.id)} />
      <DeletionReasonModal isOpen={isReasonModalOpen} onClose={() => setIsReasonModalOpen(false)} onConfirm={confirmRemoveDataPoint} reason={deletionReason} setReason={setDeletionReason} approver={deletionApprover} setApprover={setDeletionApprover}/>

      <div className="max-w-7xl mx-auto p-4 sm:p-6 bg-gradient-to-br from-blue-50 to-indigo-100 min-h-screen font-sans">
        <header className="mb-6 bg-white p-4 rounded-xl shadow-md">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <button onClick={goBack} className="text-blue-600 hover:underline flex items-center gap-2 text-sm">
                <ArrowLeft className="w-4 h-4" /> Volver a Procesos
            </button>
            <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-3">
              <BarChart3 className="text-blue-600 w-7 h-7" />
              <span>{processGroup.name}</span>
            </h1>
            <div className="flex items-center gap-2">
              <div className={`text-sm text-gray-500 flex items-center gap-2 transition-opacity duration-300 ${isSaving ? 'opacity-100' : 'opacity-0'}`}><Loader className="w-4 h-4 animate-spin" /><span>Guardando...</span></div>
              <button onClick={() => setIsAuditLogModalOpen(true)} className="bg-gray-500 text-white px-3 py-2 rounded-lg hover:bg-gray-600 flex items-center gap-2 text-sm"><History className="w-4 h-4" /> Registro</button>
              <button onClick={handleAddChart} className="bg-blue-500 text-white px-3 py-2 rounded-lg hover:bg-blue-600 flex items-center gap-2 text-sm"><Plus className="w-4 h-4" /> Nueva Carta</button>
              {processGroup.charts.length > 0 && (<button onClick={() => setIsDeleteModalOpen(true)} className="bg-red-500 text-white px-3 py-2 rounded-lg hover:bg-red-600 flex items-center gap-2 text-sm"><Trash2 className="w-4 h-4" /> Eliminar Carta</button>)}
            </div>
          </div>
          <div className="mt-4 border-t pt-4">
            <label htmlFor="chart-selector" className="block text-sm font-medium text-gray-700 mb-1">Seleccionar Carta de Control Activa:</label>
            <div className="flex gap-2">
              <select id="chart-selector" value={currentChartId} onChange={(e) => setCurrentChartId(Number(e.target.value))} className="flex-grow p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                {processGroup.charts.map(chart => <option key={chart.id} value={chart.id}>{chart.name}</option>)}
              </select>
              <input type="text" value={currentChart.name} onBlur={handleChartNameChange} onChange={(e) => { const newCharts = [...processGroup.charts]; newCharts[currentChartIndex].name = e.target.value; updateCharts(newCharts); }} className="p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent w-1/3" placeholder="Renombrar carta"/>
            </div>
          </div>
        </header>

        <main className="space-y-8">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">1. Información del MRC</h2>
              <div className="space-y-4">
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label><input name="name" type="text" value={currentChart.materialInfo.name} onBlur={handleMaterialInfoChange} onChange={(e) => { const newCharts = [...processGroup.charts]; newCharts[currentChartIndex].materialInfo.name = e.target.value; updateCharts(newCharts); }} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" /></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Lote</label><input name="lote" type="text" value={currentChart.materialInfo.lote} onBlur={handleMaterialInfoChange} onChange={(e) => { const newCharts = [...processGroup.charts]; newCharts[currentChartIndex].materialInfo.lote = e.target.value; updateCharts(newCharts); }} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"/></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Valor Certificado</label><input name="certifiedValue" type="number" step="any" value={currentChart.materialInfo.certifiedValue} onBlur={handleMaterialInfoChange} onChange={(e) => { const newCharts = [...processGroup.charts]; newCharts[currentChartIndex].materialInfo.certifiedValue = e.target.value; updateCharts(newCharts); }} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"/></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Incertidumbre (±)</label><input name="uncertainty" type="number" step="any" value={currentChart.materialInfo.uncertainty} onBlur={handleMaterialInfoChange} onChange={(e) => { const newCharts = [...processGroup.charts]; newCharts[currentChartIndex].materialInfo.uncertainty = e.target.value; updateCharts(newCharts); }} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"/></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Unidad</label><input name="unit" type="text" value={currentChart.materialInfo.unit} onBlur={handleMaterialInfoChange} onChange={(e) => { const newCharts = [...processGroup.charts]; newCharts[currentChartIndex].materialInfo.unit = e.target.value; updateCharts(newCharts); }} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"/></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Método</label><input name="method" type="text" value={currentChart.materialInfo.method} onBlur={handleMaterialInfoChange} onChange={(e) => { const newCharts = [...processGroup.charts]; newCharts[currentChartIndex].materialInfo.method = e.target.value; updateCharts(newCharts); }} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"/></div>
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">2. Ingreso de Datos</h2>
              <div className="space-y-4">
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Analista</label><input type="text" value={currentAnalyst} onChange={(e) => setCurrentAnalyst(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" list="analysts-list"/><datalist id="analysts-list">{currentChart.analystsList.map((a, i) => <option key={i} value={a} />)}</datalist></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Nuevo Valor</label><div className="flex gap-2"><input type="number" step="any" value={newValue} onChange={(e) => setNewValue(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && addDataPoint()} className="flex-1 p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" disabled={isDataEntryDisabled} /><button onClick={addDataPoint} disabled={!newValue || !currentAnalyst.trim() || isDataEntryDisabled} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2 disabled:bg-gray-400"><Plus className="w-4 h-4" /> Agregar</button></div></div>
                {isDataEntryDisabled && <p className="text-sm text-center text-blue-600 font-semibold p-2 bg-blue-50 rounded-md">Límite de 30 datos alcanzado para esta carta.</p>}
                <div className="max-h-60 overflow-y-auto border-t pt-4"><h3 className="font-medium text-gray-700 mb-2">Datos Ingresados ({currentChart.data.length})</h3>{currentChart.data.length === 0 ? <p className="text-gray-500 text-sm">No hay datos.</p> : <div className="space-y-2">{currentChart.data.slice().reverse().map((item) => (<div key={item.id} className="flex items-center justify-between bg-gray-50 p-2 rounded-md"><div className="flex-1 text-sm"><span className="font-bold text-gray-800">#{item.point}:</span> {item.value} {currentChart.materialInfo.unit || ''}<div className="text-xs text-gray-500 mt-1">{item.analyst} • {item.date} {item.time} • Lote: {item.lote || 'N/A'}</div></div><button onClick={() => startRemoveDataPoint(item.id)} className="text-red-500 hover:text-red-700 p-1 rounded-full"><Trash2 className="w-4 h-4" /></button></div>))}</div>}</div>
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">3. Estadísticas {currentChart.inheritedStats ? "(Límites Fijos)" : "(Límites Móviles)"}</h2>
              {currentChart.data.length > 1 ? (<div className="space-y-3"><div className="grid grid-cols-2 gap-4 text-center"><div className="bg-blue-50 p-3 rounded-lg"><div className="text-sm text-blue-600">Media (X̄)</div><div className="text-lg font-semibold">{displayStats.mean.toFixed(5)}</div></div><div className="bg-green-50 p-3 rounded-lg"><div className="text-sm text-green-600">Desv. Est. (s)</div><div className="text-lg font-semibold">{displayStats.stdDev.toFixed(5)}</div></div><div className="bg-red-50 p-3 rounded-lg"><div className="text-sm text-red-600">LSC (+3σ)</div><div className="text-lg font-semibold">{displayStats.ucl.toFixed(5)}</div></div><div className="bg-red-50 p-3 rounded-lg"><div className="text-sm text-red-600">LIC (-3σ)</div><div className="text-lg font-semibold">{displayStats.lcl.toFixed(5)}</div></div><div className="bg-yellow-50 p-3 rounded-lg"><div className="text-sm text-yellow-600">LSA (+2σ)</div><div className="text-lg font-semibold">{displayStats.uwl.toFixed(5)}</div></div><div className="bg-yellow-50 p-3 rounded-lg"><div className="text-sm text-yellow-600">LIA (-2σ)</div><div className="text-lg font-semibold">{displayStats.lwl.toFixed(5)}</div></div></div></div>) : <p className="text-gray-500 text-sm h-full flex items-center justify-center">Se necesitan al menos 2 puntos.</p>}
            </div>
          </div>

          {currentChart.inheritedStats && currentChart.data.length > 1 && (
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">Estadísticas Móviles (Carta Actual)</h2>
              <p className="text-sm text-gray-500 mb-4">Estos son los límites que se calcularían solo con los datos de esta carta. Sirven para comparar la variabilidad actual con los límites fijos establecidos.</p>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 text-center">
                <div className="bg-blue-50 p-3 rounded-lg"><div className="text-sm text-blue-600">Media (X̄)</div><div className="text-lg font-semibold">{currentChart.stats.mean.toFixed(5)}</div></div>
                <div className="bg-green-50 p-3 rounded-lg"><div className="text-sm text-green-600">Desv. Est. (s)</div><div className="text-lg font-semibold">{currentChart.stats.stdDev.toFixed(5)}</div></div>
                <div className="bg-red-50 p-3 rounded-lg"><div className="text-sm text-red-600">LSC</div><div className="text-lg font-semibold">{currentChart.stats.ucl.toFixed(5)}</div></div>
                <div className="bg-red-50 p-3 rounded-lg"><div className="text-sm text-red-600">LIC</div><div className="text-lg font-semibold">{currentChart.stats.lcl.toFixed(5)}</div></div>
                <div className="bg-yellow-50 p-3 rounded-lg"><div className="text-sm text-yellow-600">LSA</div><div className="text-lg font-semibold">{currentChart.stats.uwl.toFixed(5)}</div></div>
                <div className="bg-yellow-50 p-3 rounded-lg"><div className="text-sm text-yellow-600">LIA</div><div className="text-lg font-semibold">{currentChart.stats.lwl.toFixed(5)}</div></div>
              </div>
            </div>
          )}

          {currentChart.alerts.length > 0 && <div className="bg-white rounded-xl shadow-lg p-6"><h2 className="text-xl font-semibold text-gray-800 mb-4">Alertas y Observaciones</h2><div className="space-y-2">{currentChart.alerts.map((alert, index) => (<div key={index} className={`p-3 rounded-lg flex items-start gap-3 ${alert.type === 'critical' ? 'bg-red-100 text-red-800' : alert.type === 'warning' ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800'}`}><span className="font-bold text-lg mt-0.5">{alert.type === 'critical' ? '🚨' : alert.type === 'warning' ? '⚠️' : '📈'}</span><div><span className="font-semibold">{alert.type === 'critical' ? 'Crítico' : alert.type === 'warning' ? 'Advertencia' : 'Tendencia'}</span>: {alert.message}</div></div>))}</div></div>}
          {currentChart.data.length >= 3 && <div className="bg-white rounded-xl shadow-lg p-6"><div className="flex flex-wrap items-center justify-between mb-4 gap-2"><h2 className="text-xl font-semibold text-gray-800 flex items-center gap-2"><TrendingUp className="w-5 h-5 text-green-600" />Análisis de Normalidad</h2><div className={`px-3 py-1 rounded-full text-sm font-medium ${currentChart.normalityTests.isNormal ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>{currentChart.normalityTests.isNormal ? '✓ Aparentemente Normal' : '⚠️ Revisar Normalidad'}</div></div><div className="grid grid-cols-1 lg:grid-cols-2 gap-6"><div><h3 className="font-medium text-gray-700 mb-3 text-center">Histograma</h3><div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={currentChart.histogramData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="bin" /><YAxis allowDecimals={false} /><Tooltip formatter={(v) => [v, 'Frecuencia']} /><Bar dataKey="count" name="Frecuencia" fill="#3b82f6" /></BarChart></ResponsiveContainer></div></div><div><h3 className="font-medium text-gray-700 mb-3 text-center">Indicadores</h3><div className="space-y-4"><div className="bg-gray-50 p-4 rounded-lg grid grid-cols-2 gap-4 text-center"><div><div className="text-sm text-gray-600">Asimetría</div><div className={`text-lg font-semibold ${currentChart.normalityTests.isSkewnessNormal ? 'text-green-600' : 'text-red-600'}`}>{currentChart.normalityTests.skewness.toFixed(3)}</div></div><div><div className="text-sm text-gray-600">Curtosis (Exceso)</div><div className={`text-lg font-semibold ${currentChart.normalityTests.isKurtosisNormal ? 'text-green-600' : 'text-red-600'}`}>{currentChart.normalityTests.kurtosis.toFixed(3)}</div></div></div><div className="text-xs text-gray-600 bg-blue-50 p-3 rounded-lg"><p>• <strong>Asimetría:</strong> Ideal entre -2 y 2.</p><p>• <strong>Curtosis:</strong> Ideal entre -2 y 2.</p></div></div></div></div></div>}
          {currentChart.data.length > 0 && <div className="bg-white rounded-xl shadow-lg p-6"><div className="flex flex-wrap items-center justify-between mb-4 gap-3"><h2 className="text-xl font-semibold text-gray-800">Carta de Control (Gráfico I)</h2><button onClick={exportData} className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 flex items-center gap-2 text-sm"><Download className="w-4 h-4" />Exportar Datos</button></div><div className="h-96 w-full"><ResponsiveContainer><LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 20 }}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="point" label={{ value: 'Número de Punto', position: 'insideBottom', offset: -10 }} /><YAxis type="number" domain={displayStats.domain} allowDataOverflow={true} tick={false} label={{ value: currentChart.materialInfo.unit || 'Valor', angle: -90, position: 'insideLeft' }} /><Tooltip content={<CustomTooltip />} /><Legend verticalAlign="top" wrapperStyle={{ paddingBottom: '20px' }}/>
            <Line type="monotone" dataKey="value" name="Valor Medido" stroke="#1e40af" strokeWidth={2} activeDot={{ r: 8 }} />
            <Line type="monotone" dataKey="mean" name="Media" stroke="#2563eb" strokeWidth={2} strokeDasharray="5 5" dot={false} activeDot={false} />
            <Line type="monotone" dataKey="ucl" name="LSC" stroke="#dc2626" strokeDasharray="3 3" dot={false} activeDot={false} />
            <Line type="monotone" dataKey="lcl" name="LIC" stroke="#dc2626" strokeDasharray="3 3" dot={false} activeDot={false} />
            <Line type="monotone" dataKey="uwl" name="LSA" stroke="#f59e0b" strokeDasharray="2 2" dot={false} activeDot={false} />
            <Line type="monotone" dataKey="lwl" name="LIA" stroke="#f59e0b" strokeDasharray="2 2" dot={false} activeDot={false} />
            {currentChart.materialInfo.certifiedValue && !isNaN(parseFloat(currentChart.materialInfo.certifiedValue)) && (
                <Line dataKey="dummy" name="Valor Certificado" stroke="#7c3aed" strokeWidth={2} strokeDasharray="10 5" dot={false} activeDot={false} />
            )}
            {currentChart.materialInfo.certifiedValue && !isNaN(parseFloat(currentChart.materialInfo.certifiedValue)) && (<ReferenceLine y={parseFloat(currentChart.materialInfo.certifiedValue)} stroke="#7c3aed" strokeWidth={2} strokeDasharray="10 5" />)}
          </LineChart></ResponsiveContainer></div></div>}
        </main>
      </div>
    </>
  );
};

// --- Modal Components ---
const DeleteConfirmationModal = ({ isOpen, onClose, onConfirm, chartName }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
        <div className="flex items-center"><div className="bg-red-100 p-3 rounded-full mr-4"><AlertTriangle className="w-6 h-6 text-red-600" /></div><div><h2 className="text-xl font-bold text-gray-900">Confirmar Eliminación</h2><p className="text-gray-600 mt-1">¿Estás seguro de que quieres eliminar la carta "<strong>{chartName}</strong>"?</p></div></div>
        <div className="mt-6 flex justify-end gap-3"><button onClick={onClose} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">Cancelar</button><button onClick={onConfirm} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">Sí, Eliminar</button></div>
      </div>
    </div>
  );
};

const DeletionReasonModal = ({ isOpen, onClose, onConfirm, reason, setReason, approver, setApprover }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
                <h2 className="text-xl font-bold text-gray-900 mb-4">Confirmar Eliminación de Punto</h2>
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Razón de Eliminación</label>
                        <textarea value={reason} onChange={(e) => setReason(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" rows="3" placeholder="Ej: Error de transcripción, valor atípico confirmado..."></textarea>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del Responsable</label>
                        <input type="text" value={approver} onChange={(e) => setApprover(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="Quien autoriza la eliminación"/>
                    </div>
                </div>
                <div className="mt-6 flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">Cancelar</button>
                    <button onClick={onConfirm} disabled={!reason.trim() || !approver.trim()} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-400">Confirmar Eliminación</button>
                </div>
            </div>
        </div>
    );
};

const AuditLogModal = ({ isOpen, onClose, auditLog }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-4xl h-full max-h-[90vh] flex flex-col">
                <div className="flex justify-between items-center mb-4 border-b pb-3">
                    <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><History className="w-6 h-6 text-blue-600"/>Registro de Auditoría</h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-800 text-3xl leading-none">&times;</button>
                </div>
                <div className="overflow-y-auto flex-grow">
                    {auditLog.length === 0 ? <p>No hay eventos registrados.</p> : (
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50 sticky top-0"><tr><th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Fecha y Hora</th><th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Analista</th><th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Acción</th><th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Detalles</th></tr></thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {auditLog.map(log => (
                                    <tr key={log.id}>
                                        <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{new Date(log.timestamp).toLocaleString('es-CO')}</td>
                                        <td className="px-4 py-3 text-sm text-gray-900">{log.analyst}</td>
                                        <td className="px-4 py-3 text-sm"><span className="font-semibold text-blue-800">{log.action.replace(/_/g, ' ')}</span></td>
                                        <td className="px-4 py-3 text-sm text-gray-700">{formatLogDetails(log)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
};

const formatLogDetails = (log) => {
    const details = log.details;
    switch (log.action) {
        case 'CREATE_CHART': return `Se creó la carta: "${details.chartName}"`;
        case 'DELETE_CHART': return `Se eliminó la carta: "${details.chartName}"`;
        case 'RENAME_CHART': return `Se renombró "${log.chartName}" de "${details.from}" a "${details.to}"`;
        case 'UPDATE_MRC_INFO': return `En "${log.chartName}", se cambió ${details.field} de "${details.from}" a "${details.to}"`;
        case 'ADD_DATA_POINT': return `En "${log.chartName}", se añadió el punto #${details.point} con valor: ${details.value} (Lote: ${details.lote || 'N/A'})`;
        case 'DELETE_DATA_POINT': return `En "${log.chartName}", se eliminó el punto #${details.point} (valor: ${details.value}, Lote: ${details.lote || 'N/A'}). Razón: ${details.reason}. Aprobado por: ${details.approver}`;
        default: return JSON.stringify(details);
    }
};

export default App;
