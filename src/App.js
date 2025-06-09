import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, onSnapshot, query, writeBatch, getDocs } from 'firebase/firestore';

// --- Configuración de Firebase ---
// PEGA AQUÍ LA CONFIGURACIÓN DE TU PROYECTO DE FIREBASE
const firebaseConfig = {
  apiKey: "AIzaSyAI7-Ml58FrlqsLveUvP4ZMBlDvjVw3sgo",
  authDomain: "benfor-postobon.firebaseapp.com",
  projectId: "benfor-postobon",
  storageBucket: "benfor-postobon.firebasestorage.app",
  messagingSenderId: "T1071843653916",
  appId: "1:1071843653916:web:bf93fb9bdc852744aea2d9"
};
const appIdForPath = 'benfor-tracker-default';

// --- Datos Iniciales y Estructura ---
const initialUnitsData = [
    { id: 1, ordenTrabajo: "14142", modelo: "12 ESTIBAS PB (PLATAFORMA)", equipoModelo: 1 }, { id: 2, ordenTrabajo: "14142", modelo: "12 ESTIBAS PB (PLATAFORMA)", equipoModelo: 2 }, { id: 3, ordenTrabajo: "14142", modelo: "12 ESTIBAS PB (PLATAFORMA)", equipoModelo: 3 }, { id: 4, ordenTrabajo: "14142", modelo: "12 ESTIBAS PB (PLATAFORMA)", equipoModelo: 4 }, { id: 5, ordenTrabajo: "14141", modelo: "10 ESTIBAS PB (PLATAFORMA)", equipoModelo: 1 }, ...Array.from({ length: 27 }, (_, i) => ({ id: 6 + i, ordenTrabajo: "14143", modelo: "12 ESTIBAS", equipoModelo: i + 1 })), ...Array.from({ length: 24 }, (_, i) => ({ id: 33 + i, ordenTrabajo: "14140", modelo: "10 ESTIBAS", equipoModelo: i + 1 }))
];
const subassemblyTemplate = (responsable) => ({ status: 'Pendiente', responsable, fechaCompletado: null, completadoPor: null });
const stationTemplate = (nombre, tareas, extraFields = {}) => ({ nombre, status: 'Pendiente', tareas: tareas.reduce((acc, t) => ({...acc, [t]: false}), {}), aprobadoPorCargo: null, aprobadoPorNombre: null, fechaAprobacion: null, anotacionInspeccion: '', ...extraFields });
const getDefaultUnitStructure = (baseData) => ({ ...baseData, statusGeneral: 'Pendiente', isDetenido: false, isEntregado: false, fechaEntrega: null, responsableEntrega: '', recibidoPor: '', contratista: '', fechaInicio: '', fechaFinPrevista: '', observaciones: '', subensambles: { acoplador: subassemblyTemplate('Jorge Forero'), trenApoyo: subassemblyTemplate('Jorge Forero'), tubosSuspension: subassemblyTemplate('Jorge Forero'), mamparas: subassemblyTemplate('Jorge Forero'), caballetes: subassemblyTemplate('Jorge Forero'), puertasAbatibles: subassemblyTemplate('Carlos Colon'), pisosAbatibles: subassemblyTemplate('Jorge Colon'), puertasRolloUp: subassemblyTemplate('Eduardo Cadena') }, estaciones: { estacion1: stationTemplate('Estructura Principal (Contratistas)', ['ensamblarMonoViga', 'montarAcoplador', 'montarTrenApoyo', 'montarSuspension'], { numeroEje: '' }), estacion2: stationTemplate('Carrozado Inicial (Contratistas)', ['montarPuentes', 'montarLaterales', 'montarMamparas', 'montarCaballetes', 'montarMarcoTrasero', 'montarSoleras']), estacion3: stationTemplate('Pisos, Techos y Forros', ['montarPisos', 'montajePisosAbatibles', 'montarArcoTechos', 'instalarForroDelantero', 'instalarForrosCamaBaja', 'instalarTecho'], { tecnicoAsignado: '' }), estacion4: stationTemplate('Puertas y Preparación Pintura', ['instalarPuertas', 'alistarParaPintura'], { tecnicoAsignado: '' }), estacion5: stationTemplate('Pintura', ['aplicarFondo', 'aplicarPinturaFinal', 'controlCalidadPintura'], { tecnicoAsignado: '' }), estacion6: stationTemplate('Sistema Eléctrico y Neumático', ['instalarLuces', 'instalarFrenosNeumaticos'], { serialValvulaABS: '', tecnicoAsignado: '' }), estacion7: stationTemplate('Alistamiento Final', ['alistamientoLimpiezaFinal', 'instalarPublicidad', 'inspeccionCalidadFinal', 'instalarPlataforma'], { tecnicoAsignado: '' }), } });

// --- Helper Functions ---
const getUnitDisplayStatus = (unit) => {
    if (!unit) return 'Pendiente';
    if (unit.isEntregado) return 'Entregado';
    if (unit.isDetenido) return 'Detenido';
    if (unit.estaciones?.estacion7?.status === 'Aprobado') return 'Completado';
    const anyStationActive = Object.values(unit.estaciones || {}).some(s => s.status !== 'Pendiente');
    if (anyStationActive) return 'En Proceso';
    return 'Pendiente';
};
const getStatusColorClass = (status) => `status-${status.replace(' ', '-')}`;

// --- Componentes ---
const GeminiModal = ({ title, content, onClose, isLoading }) => ( <div className="modal-overlay"> <div className="modal-box"> <div className="modal-header"> <h3 className="modal-title">{title}</h3> <button onClick={onClose} className="modal-close-button">&times;</button> </div> <div> {isLoading ? ( <div className="loading-spinner-container"> <div className="loading-spinner"></div> <p>Generando, por favor espere...</p> </div> ) : ( <p className="modal-content">{content}</p> )} </div> <div className="modal-footer"> <button onClick={onClose} className="button">Cerrar</button> </div> </div> </div> );
const DeliveryModal = ({ onClose, onSave }) => {
    const [deliveryData, setDeliveryData] = useState({ fecha: new Date().toISOString().slice(0, 10), responsable: '', recibe: '' });
    const handleChange = (e) => { const { name, value } = e.target; setDeliveryData(prev => ({ ...prev, [name]: value })); };
    const handleSave = () => { if (!deliveryData.fecha || !deliveryData.responsable.trim() || !deliveryData.recibe.trim()) { alert('Todos los campos son obligatorios.'); return; } onSave(deliveryData); };
    return ( <div className="modal-overlay"> <div className="modal-box"> <h3 className="modal-title">Registrar Entrega de Unidad</h3> <div className="modal-form-container"> <div className="form-group"> <label>Fecha de Entrega</label> <input type="date" name="fecha" value={deliveryData.fecha} onChange={handleChange} /> </div> <div className="form-group"> <label>Responsable de la Entrega (Benfor)</label> <input type="text" name="responsable" value={deliveryData.responsable} onChange={handleChange} placeholder="Nombre de quien entrega" /> </div> <div className="form-group"> <label>Recibido Por (Cliente)</label> <input type="text" name="recibe" value={deliveryData.recibe} onChange={handleChange} placeholder="Nombre de quien recibe" /> </div> </div> <div className="modal-footer"> <button onClick={onClose} className="button">Cancelar</button> <button onClick={handleSave} className="button button-confirm">Guardar Entrega</button> </div> </div> </div> );
};
const ResetConfirmModal = ({ onClose, onConfirm }) => ( <div className="modal-overlay"> <div className="modal-box"> <h3 className="modal-title error-text">Confirmar Reinicio de Unidad</h3> <p>¿Está seguro de que desea reiniciar esta unidad? Toda la información de progreso, aprobaciones y datos registrados se perderán y la unidad volverá a su estado inicial. Esta acción no se puede deshacer.</p> <div className="modal-footer"> <button onClick={onClose} className="button">Cancelar</button> <button onClick={onConfirm} className="button button-danger">Sí, Reiniciar</button> </div> </div> </div> );

const LoginScreen = ({ onLogin }) => {
    const [role, setRole] = useState('Visual');
    const [title, setTitle] = useState('Jefe de Planta');
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const passwordMap = { 'Director de Manufactura': 'Raul456*012', 'Jefe de Planta': 'Carlos789*789', 'Coordinador de Calidad': 'Jose458*123', 'Coordinador de Produccion': 'Oscar856*456' };
    const handleLogin = (e) => { e.preventDefault(); setError(''); let userTitle = role; if (role === 'Gerencial') userTitle = 'Director de Manufactura'; if (role === 'Usuario') userTitle = title; if (role === 'Visual') { onLogin({ role: 'Visual', title: 'Visual', name: 'Observador' }); return; } if (!name.trim()) { setError('Por favor, digite su nombre.'); return; } if (passwordMap[userTitle] !== password) { setError('La contraseña es incorrecta para el cargo seleccionado.'); return; } onLogin({ role, title: userTitle, name: name.trim() }); };
    return ( <div className="login-screen"> <div className="login-box"> <h1 className="login-title"><span className="title-accent">BEN</span>FOR</h1><p className="subtitle">Proyecto Postobón</p> <form onSubmit={handleLogin}> <div className="form-group"> <label htmlFor="role">Seleccione su Rol</label> <select id="role" value={role} onChange={(e) => {setRole(e.target.value); setError('')}}> <option value="Visual">Visual (Solo Consulta)</option> <option value="Usuario">Inspector (Usuario)</option> <option value="Gerencial">Director de Manufactura (Gerencial)</option> </select> </div> {role === 'Usuario' && ( <div className="form-group"> <label htmlFor="title">Seleccione su Cargo</label> <select id="title" value={title} onChange={(e) => {setTitle(e.target.value); setError('')}}> <option value="Jefe de Planta">Jefe de Planta</option> <option value="Coordinador de Calidad">Coordinador de Calidad</option> <option value="Coordinador de Produccion">Coordinador de Producción</option> </select> </div> )} {(role === 'Usuario' || role === 'Gerencial') && ( <> <div className="form-group"> <label htmlFor="name">Digite su Nombre</label> <input type="text" id="name" value={name} onChange={(e) => {setName(e.target.value); setError('')}} placeholder="Su nombre completo" /> </div> <div className="form-group"> <label htmlFor="password">Contraseña</label> <input type="password" id="password" value={password} onChange={(e) => {setPassword(e.target.value); setError('')}} /> </div> </> )} {error && <p className="login-error">{error}</p>} <button type="submit" className="button button-primary">Ingresar</button> </form> </div> </div> );
};

const Dashboard = ({ units }) => {
    const stats = useMemo(() => {
        const unitsWithStatus = units.map(u => ({ ...u, displayStatus: getUnitDisplayStatus(u) }));
        const totalUnits = unitsWithStatus.length;
        const completedUnits = unitsWithStatus.filter(u => u.displayStatus === 'Completado').length;
        const inProgressUnits = unitsWithStatus.filter(u => u.displayStatus === 'En Proceso').length;
        const pendingUnits = unitsWithStatus.filter(u => u.displayStatus === 'Pendiente').length;
        const stoppedUnits = unitsWithStatus.filter(u => u.displayStatus === 'Detenido').length;
        const deliveredUnits = unitsWithStatus.filter(u => u.displayStatus === 'Entregado').length;
        const progressPercentage = totalUnits > 0 ? ((completedUnits + deliveredUnits) / totalUnits) * 100 : 0;
        const contractorCounts = units.reduce((acc, unit) => { const contractor = unit.contratista || 'Sin Asignar'; acc[contractor] = (acc[contractor] || 0) + 1; return acc; }, {});
        return { totalUnits, completedUnits, inProgressUnits, pendingUnits, stoppedUnits, deliveredUnits, progressPercentage, contractorCounts };
    }, [units]);
    return (<div className="card dashboard-card"><h2 className="main-title">Resumen General de Producción</h2><div className="dashboard-grid"><div className="dashboard-item"><h3 className="dashboard-item-title">Avance General</h3><div className="progress-bar"><div className="progress-bar-inner" style={{ width: `${stats.progressPercentage}%` }}></div></div><p className="dashboard-item-value">{stats.progressPercentage.toFixed(1)}%</p><p>{stats.completedUnits + stats.deliveredUnits} de {stats.totalUnits} unidades finalizadas</p></div><div className="dashboard-item"><h3 className="dashboard-item-title">Estado de Unidades</h3><p><strong>Entregadas:</strong> {stats.deliveredUnits}</p><p><strong>En Proceso:</strong> {stats.inProgressUnits}</p><p><strong>Pendientes:</strong> {stats.pendingUnits}</p><p><strong>Detenidas:</strong> {stats.stoppedUnits}</p></div><div className="dashboard-item"><h3 className="dashboard-item-title">Distribución por Contratista</h3><ul className="dashboard-list">{Object.entries(stats.contractorCounts).map(([name, count]) => (<li key={name}><span>{name}:</span><span>{count}</span></li>))}</ul></div></div></div>);
};

const UnitList = ({ units, onSelectUnit }) => { 
    const calculateProgress = (unit) => {
        if (!unit || !unit.estaciones) return 0;
        const approvedStations = Object.values(unit.estaciones).filter(s => s.status === 'Aprobado').length;
        return (approvedStations / 7) * 100;
    };
    return (
        <div>
            <Dashboard units={units} />
            <h1 className="main-title">Lista de Unidades</h1>
            <div className="unit-list-grid">
                {units.map(unit => {
                    const progress = calculateProgress(unit);
                    const displayStatus = getUnitDisplayStatus(unit);
                    return (
                        <div key={unit.id} onClick={() => onSelectUnit(unit.id)} className="unit-card">
                            <div className="unit-card-content">
                                <div className="unit-card-header">
                                    <h3>Unidad #{unit.id}</h3>
                                    <span className={`status-dot ${getStatusColorClass(displayStatus)}`}></span>
                                </div>
                                <div className="unit-card-details">
                                    <p>OT: {unit.ordenTrabajo}</p>
                                    <p className="model">{unit.modelo}</p>
                                    <p>Contratista: {unit.contratista || 'N/A'}</p>
                                </div>
                                <div className="status-badge-container">
                                    <span className={`status-badge ${getStatusColorClass(displayStatus)}`}>{displayStatus}</span>
                                </div>
                            </div>
                            <div className="progress-container">
                                <p className="progress-label">Avance en Planta</p>
                                <div className="progress-bar">
                                    <div className="progress-bar-inner" style={{ width: `${progress}%` }}></div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const SubassemblyItem = ({ data, onChange, disabled }) => (
    <div className="subassembly-item">
        <div className="subassembly-main">
            <span className="subassembly-label">{data.label}</span>
            <span className="subassembly-responsable">{data.responsable}</span>
            <select value={data.status} onChange={onChange} disabled={disabled}>
                <option value="Pendiente">Pendiente</option>
                <option value="En Proceso">En Proceso</option>
                <option value="Completado">Completado</option>
            </select>
        </div>
        {data.status === 'Completado' && data.completadoPor && (
            <div className="subassembly-approval-info">
                Aprobado por {data.completadoPor} el {new Date(data.fechaCompletado).toLocaleDateString()}
            </div>
        )}
    </div>
);
const TaskItem = ({ label, name, checked, onChange, disabled }) => (<div className="task-item"><input type="checkbox" id={name} name={name} checked={checked} onChange={onChange} disabled={disabled} /><label htmlFor={name}>{label}</label></div>);

const StationCard = ({ stationKey, stationData, isLocked, onDataChange, onApprove, onRevertApproval, user, unitModel }) => {
    const [approvalAttempted, setApprovalAttempted] = useState(false);
    const isCompleted = stationData.status === 'Completado';
    const isApproved = stationData.status === 'Aprobado';
    const canApprove = user.role === 'Gerencial' || user.role === 'Usuario';
    const isFieldDisabled = (fieldType = 'any') => {
        if (user.role === 'Gerencial') return false; 
        if (isLocked || isApproved) return true;
        if (fieldType === 'task' && isCompleted) return true;
        return false;
    };
    const isTecnicoRequired = ['estacion3', 'estacion4', 'estacion5', 'estacion6', 'estacion7'].includes(stationKey);
    const isNumeroEjeRequired = stationKey === 'estacion1';
    const isSerialValvulaABSRequired = stationKey === 'estacion6';
    const isApprovalDisabled = (isNumeroEjeRequired && !stationData.numeroEje?.trim()) || (isSerialValvulaABSRequired && !stationData.serialValvulaABS?.trim()) || (isTecnicoRequired && !stationData.tecnicoAsignado?.trim());
    const tecnicoError = approvalAttempted && isTecnicoRequired && !stationData.tecnicoAsignado?.trim();
    const numeroEjeError = approvalAttempted && isNumeroEjeRequired && !stationData.numeroEje?.trim();
    const serialValvulaABSError = approvalAttempted && isSerialValvulaABSRequired && !stationData.serialValvulaABS?.trim();
    useEffect(() => {
        if (stationData.status === 'En Proceso' && !isFieldDisabled('task')) {
            const allTasksDone = Object.entries(stationData.tareas).every(([key, value]) => {
                if (key === 'instalarPlataforma' && !unitModel.includes('PLATAFORMA')) return true;
                return value;
            });
            if (allTasksDone) onDataChange(stationKey, 'status', 'Completado');
        }
    }, [stationData.tareas, stationData.status, onDataChange, stationKey, unitModel, user.role]);
    const handleTaskToggle = (taskKey, isChecked) => { if (isChecked && stationData.status === 'Pendiente') { onDataChange(stationKey, 'status', 'En Proceso'); } onDataChange(stationKey, `tareas.${taskKey}`, isChecked); };
    const handleApproveClick = () => { setApprovalAttempted(true); if (!isApprovalDisabled) onApprove(stationKey); };

    return (
        <div className={`card station-card ${isLocked && user.role !== 'Gerencial' ? 'locked' : ''} ${isApproved ? 'approved' : ''}`}>
            <div className="station-header">
                <h4>{stationData.nombre}</h4>
                <span className={`status-badge ${getStatusColorClass(stationData.status)}`}>{stationData.status}</span>
            </div>
            <div className="station-tasks">
                {Object.entries(stationData.tareas).map(([taskKey, taskValue]) => {
                    if (taskKey === 'instalarPlataforma' && !unitModel.includes('PLATAFORMA')) return null;
                    return <TaskItem key={taskKey} label={taskKey.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())} name={taskKey} checked={taskValue} onChange={(e) => handleTaskToggle(taskKey, e.target.checked)} disabled={isFieldDisabled('task')} />
                })}
            </div>
            <div className="station-details">
                {stationData.tecnicoAsignado !== undefined && (<div className="form-group"><label>Técnico Asignado (Benfor)</label><input type="text" value={stationData.tecnicoAsignado} onChange={(e) => onDataChange(stationKey, 'tecnicoAsignado', e.target.value)} placeholder="Nombre del técnico" className={tecnicoError ? 'input-error' : ''} disabled={isFieldDisabled()} /></div>)}
                {stationData.numeroEje !== undefined && (<div className="form-group"><label>Número del Eje de Suspensión</label><input type="text" value={stationData.numeroEje} onChange={(e) => onDataChange(stationKey, 'numeroEje', e.target.value)} placeholder="Serial del eje" className={numeroEjeError ? 'input-error' : ''} disabled={isFieldDisabled()} /></div>)}
                {stationData.serialValvulaABS !== undefined && (<div className="form-group"><label>Serial Válvula ABS</label><input type="text" value={stationData.serialValvulaABS} onChange={(e) => onDataChange(stationKey, 'serialValvulaABS', e.target.value)} placeholder="Serial de la válvula" className={serialValvulaABSError ? 'input-error' : ''} disabled={isFieldDisabled()} /></div>)}
                <div className="form-group"><label>Anotaciones de la Estación</label><textarea value={stationData.anotacionInspeccion} onChange={(e) => onDataChange(stationKey, 'anotacionInspeccion', e.target.value)} rows="2" placeholder="Dejar una nota si es necesario..." disabled={isFieldDisabled()}></textarea></div>
            </div>
            {(isCompleted || isApproved) && (
                 <div className="station-approval">
                     <h5>Aprobación Final</h5>
                     {isCompleted && !isApproved && (<div>{canApprove ? (<button onClick={handleApproveClick} className="button button-confirm" disabled={isApprovalDisabled} title={isApprovalDisabled ? "Complete los campos requeridos para aprobar" : "Aprobar Estación"}>Aprobar Estación</button>) : (<p>Esperando aprobación...</p>)}{approvalAttempted && isApprovalDisabled && canApprove && <p className="login-error">Debe registrar los datos requeridos.</p>}</div>)}
                     {isApproved && (<div className="approval-info"><p>Aprobado por: <strong>{stationData.aprobadoPorNombre}</strong> ({stationData.aprobadoPorCargo})</p><p>Fecha: {new Date(stationData.fechaAprobacion).toLocaleString()}</p>{user.role === 'Gerencial' && <button onClick={() => onRevertApproval(stationKey)} className="button button-revert">Deshacer Aprobación</button>}</div>)}
                 </div>
            )}
        </div>
    );
};

const UnitForm = ({ unit, onUpdate, onBack, user }) => {
    const [formData, setFormData] = useState(unit);
    const [isSaving, setIsSaving] = useState(false);
    const [contractorError, setContractorError] = useState(false);
    const [showDeliveryModal, setShowDeliveryModal] = useState(false);
    const [showResetModal, setShowResetModal] = useState(false);

    const isReadOnly = user.role === 'Visual';
    const canEdit = user.role === 'Gerencial' || user.role === 'Usuario';
    const displayStatus = useMemo(() => getUnitDisplayStatus(formData), [formData]);
    const isCompleted = displayStatus === 'Completado';
    const stationOrder = useMemo(() => ['estacion1', 'estacion2', 'estacion3', 'estacion4', 'estacion5', 'estacion6', 'estacion7'], []);
    useEffect(() => { setFormData(unit); }, [unit]);

    const handleChange = (e) => { const { name, value } = e.target; setFormData(prev => ({ ...prev, [name]: value })); };
    const handleSubassemblyChange = (name, value) => {
        setFormData(prev => {
            const newSubensambles = { ...prev.subensambles };
            newSubensambles[name].status = value;
            if (value === 'Completado') {
                newSubensambles[name].fechaCompletado = new Date().toISOString();
                newSubensambles[name].completadoPor = `${user.name} (${user.title})`;
            } else {
                newSubensambles[name].fechaCompletado = null;
                newSubensambles[name].completadoPor = null;
            }
            return { ...prev, subensambles: newSubensambles };
        });
    };
    const handleStationDataChange = (stationKey, field, value) => {
        setFormData(prev => {
            const newStations = { ...prev.estaciones };
            const path = field.split('.');
            let current = newStations[stationKey];
            for (let i = 0; i < path.length - 1; i++) { current = current[path[i]]; }
            current[path[path.length - 1]] = value;
            return { ...prev, estaciones: newStations };
        });
    };
    const handleApproveStation = (stationKey) => {
        const now = new Date().toISOString();
        setFormData(prev => {
             const newStations = { ...prev.estaciones };
             newStations[stationKey] = { ...newStations[stationKey], status: 'Aprobado', aprobadoPorCargo: user.title, aprobadoPorNombre: user.name, fechaAprobacion: now };
             return { ...prev, estaciones: newStations };
        });
    };
    const handleRevertApproval = (stationKey) => {
        if (user.role !== 'Gerencial') return;
        setFormData(prev => {
             const newStations = { ...prev.estaciones };
             newStations[stationKey] = { ...newStations[stationKey], status: 'Completado', aprobadoPorCargo: null, aprobadoPorNombre: null, fechaAprobacion: null };
             return { ...prev, estaciones: newStations };
        });
    }

    const handleToggleDetenido = () => setFormData(prev => ({...prev, isDetenido: !prev.isDetenido }));
    const handleSaveDelivery = (deliveryData) => {
        setFormData(prev => ({ ...prev, isEntregado: true, isDetenido: false, fechaEntrega: deliveryData.fecha, responsableEntrega: deliveryData.responsable, recibidoPor: deliveryData.recibe, statusGeneral: 'Entregado' }));
        setShowDeliveryModal(false);
    };
    const handleResetUnit = async () => {
        const baseData = { id: formData.id, ordenTrabajo: formData.ordenTrabajo, modelo: formData.modelo, equipoModelo: formData.equipoModelo, };
        const resetData = getDefaultUnitStructure(baseData);
        await onUpdate(resetData);
        setShowResetModal(false);
    };

    const handleSave = async () => { 
        if (!canEdit) return;
        const anyStationStarted = Object.values(formData.estaciones).some(station => station.status !== 'Pendiente');
        if (anyStationStarted && !formData.contratista) { alert('Debe asignar un contratista antes de guardar el progreso.'); setContractorError(true); return; }
        setContractorError(false);
        setIsSaving(true); 
        await onUpdate(formData); 
        setIsSaving(false); 
    };
    if (!formData) return <div>Cargando...</div>;
    return (
        <div className="form-container">
            {showDeliveryModal && <DeliveryModal onClose={() => setShowDeliveryModal(false)} onSave={handleSaveDelivery} />}
            {showResetModal && <ResetConfirmModal onClose={() => setShowResetModal(false)} onConfirm={handleResetUnit} />}
            <div className="form-header">
                <button onClick={onBack} className="button">&larr; Volver</button>
                <div className="form-header-actions">
                    {canEdit && <button onClick={handleSave} disabled={isSaving || isReadOnly} className="button button-primary">{isSaving ? 'Guardando...' : 'Guardar Cambios'}</button>}
                </div>
            </div>
            <div className="card unit-details-card">
                <div className="unit-details-header">
                    <h2>Unidad #{formData.id}</h2>
                    <div className="unit-actions">
                        <span className={`status-badge ${getStatusColorClass(displayStatus)}`}>{displayStatus}</span>
                        {canEdit && !formData.isEntregado && ( <button onClick={handleToggleDetenido} className={`button ${formData.isDetenido ? 'button-resume' : 'button-stop'}`}> {formData.isDetenido ? 'Reanudar' : 'Poner en Detenido'} </button> )}
                        {canEdit && isCompleted && !formData.isEntregado && ( <button onClick={() => setShowDeliveryModal(true)} className="button button-confirm">Registrar Entrega</button> )}
                    </div>
                </div>
                <div className="unit-details-grid">
                    <p><strong>OT:</strong> {formData.ordenTrabajo}</p>
                    <p><strong>Modelo:</strong> {formData.modelo}</p>
                    <p><strong>Equipo:</strong> {formData.equipoModelo}</p>
                    <div className="form-group"><label>Contratista:</label><select name="contratista" value={formData.contratista} onChange={(e) => {handleChange(e); setContractorError(false);}} disabled={isReadOnly || formData.isEntregado} className={contractorError ? 'input-error' : ''}><option value="">Sin Asignar</option><option>Wilder Martinez</option><option>Henrry Tapias</option><option>Sanabria</option><option>Rubén Torres</option></select></div>
                </div>
                {formData.isEntregado && ( <div className="delivery-details"><h4>Detalles de Entrega</h4><p><strong>Fecha:</strong> {new Date(formData.fechaEntrega).toLocaleDateString()}</p><p><strong>Entregado por:</strong> {formData.responsableEntrega}</p><p><strong>Recibido por:</strong> {formData.recibidoPor}</p></div> )}
            </div>
            <div className="card"><h3>Subensambles</h3>
                {Object.entries({acoplador: 'Acoplador', trenApoyo: 'Tren de Apoyo', tubosSuspension: 'Tubos Suspensión', mamparas: 'Mamparas', caballetes: 'Caballetes', puertasAbatibles: 'Puertas Abatibles', pisosAbatibles: 'Pisos Abatibles', puertasRolloUp: 'Puertas Rollo Up'})
                .map(([key, label]) => {
                    const subassembly = formData.subensambles[key];
                    const isDisabled = isReadOnly || formData.isEntregado || (user.role === 'Usuario' && subassembly.status === 'Completado');
                    return <SubassemblyItem key={key} data={{label, ...subassembly}} onChange={(e) => handleSubassemblyChange(key, e.target.value)} disabled={isDisabled}/>
                })}
            </div>
            <div className="stations-container"><h3>Línea de Ensamble y Acabados</h3>{stationOrder.map((key, index) => { const isLocked = index > 0 && formData.estaciones[stationOrder[index-1]].status !== 'Aprobado'; return (<StationCard key={key} stationKey={key} stationData={formData.estaciones[key]} isLocked={isLocked || formData.isEntregado} onDataChange={handleStationDataChange} onApprove={handleApproveStation} onRevertApproval={handleRevertApproval} user={user} canEdit={canEdit} unitModel={formData.modelo} />);})}</div>
            <div className="card"><h3>Observaciones y Novedades</h3><textarea name="observaciones" value={formData.observaciones} onChange={handleChange} rows="4" disabled={isReadOnly || formData.isEntregado}></textarea></div>
            {user.role === 'Gerencial' && !formData.isEntregado && (
                <div className="reset-section">
                    <button onClick={() => setShowResetModal(true)} className="button button-danger">Reiniciar Unidad</button>
                    <p>Esta acción devolverá la unidad a su estado inicial. Úselo con precaución.</p>
                </div>
            )}
        </div>
    );
};


const App = () => {
    const [currentUser, setCurrentUser] = useState(null);
    const [view, setView] = useState('list');
    const [units, setUnits] = useState([]);
    const [selectedUnitId, setSelectedUnitId] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [db, setDb] = useState(null);
    
    useEffect(() => {
        try {
            if (firebaseConfig && firebaseConfig.apiKey && firebaseConfig.apiKey !== "TU_API_KEY_AQUI") {
                const app = initializeApp(firebaseConfig);
                const firestoreDb = getFirestore(app);
                const firebaseAuth = getAuth(app);
                setDb(firestoreDb);
                onAuthStateChanged(firebaseAuth, async (user) => { if (!user) { await signInAnonymously(firebaseAuth).catch(e => console.error(e)); }});
            } else {
                 console.log("Configuración de Firebase no encontrada.");
                 setLoading(false);
            }
        } catch (e) {
            console.error("Error al inicializar Firebase:", e);
            setError("No se pudo conectar con la base de datos.");
            setLoading(false);
        }
    }, []);

    const seedDatabase = useCallback(async (firestoreDb) => {
        if (!firestoreDb) return;
        const unitsCollectionRef = collection(firestoreDb, `artifacts/${appIdForPath}/public/data/units`);
        const collectionSnap = await getDocs(unitsCollectionRef);
        if (collectionSnap.size !== initialUnitsData.length) {
             const batch = writeBatch(firestoreDb);
             collectionSnap.docs.forEach(doc => { batch.delete(doc.ref); });
             initialUnitsData.forEach(unitBase => { 
                const unitData = getDefaultUnitStructure(unitBase); 
                const unitRef = doc(firestoreDb, `artifacts/${appIdForPath}/public/data/units`, `${unitData.id}`); 
                batch.set(unitRef, unitData); 
            });
            await batch.commit();
        }
    }, []);
    
    useEffect(() => {
        if (!db || !currentUser) { return; }
        
        const setupListener = async () => {
            setLoading(true);
            await seedDatabase(db);
            const q = query(collection(db, `artifacts/${appIdForPath}/public/data/units`));
            const unsubscribe = onSnapshot(q, (querySnapshot) => {
                const unitsData = [];
                querySnapshot.forEach((doc) => { unitsData.push({ id: doc.id, ...doc.data() }); });
                unitsData.sort((a, b) => parseInt(a.id) - parseInt(b.id));
                setUnits(unitsData);
                setLoading(false);
            }, (err) => { console.error(err); setError("Error al obtener datos."); setLoading(false); });
            return () => unsubscribe();
        };
        setupListener();
    }, [db, currentUser, seedDatabase]);

    const handleLogin = (user) => { setCurrentUser(user); };
    const handleLogout = () => { setCurrentUser(null); setView('list'); setSelectedUnitId(null); };
    const handleSelectUnit = (unitId) => { setSelectedUnitId(unitId); setView('form'); };
    const handleBackToList = () => { setSelectedUnitId(null); setView('list'); };
    const handleUpdateUnit = async (updatedUnitData) => {
        if (!db || currentUser.role === 'Visual') return;
        try { const unitRef = doc(db, `artifacts/${appIdForPath}/public/data/units`, `${updatedUnitData.id}`); await updateDoc(unitRef, updatedUnitData); } catch (e) { console.error(e); }
    };
    
    if (!currentUser) { return <LoginScreen onLogin={handleLogin} />; }

    return (
        <div className="app-container">
            <header className="header"><div><h1 className="header-title"><span className="title-accent">BEN</span>FOR</h1><p className="header-subtitle">Proyecto Postobón</p></div><div className="user-info"><span><strong>{currentUser.name}</strong> ({currentUser.title})</span><button onClick={handleLogout}>Cerrar Sesión</button></div></header>
            <main className="main-container">
                {loading ? <div className="loading">Cargando datos...</div> : 
                 error ? <div className="error">{error}</div> : (
                    <>
                        {view === 'list' ? <UnitList units={units} onSelectUnit={handleSelectUnit} /> : null}
                        {view === 'form' && selectedUnitId ? (<UnitForm unit={units.find(u => u.id == selectedUnitId)} onUpdate={handleUpdateUnit} onBack={handleBackToList} user={currentUser} />) : null}
                    </>
                 )
                }
            </main>
            <footer className="footer"><p>&copy; {new Date().getFullYear()} Benfor. Todos los derechos reservados.</p></footer>
        </div>
    );
};

export default App;
