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
  messagingSenderId: "1071843653916",
  appId: "1:1071843653916:web:bf93fb9bdc852744aea2d9"
};
const appIdForPath = 'benfor-tracker-default'; // Se usa para la ruta en la base de datos

// --- Datos Iniciales y Estructura ---
const initialUnitsData = [
    // Orden 14142: 4 unidades
    { id: 1, ordenTrabajo: "14142", modelo: "12 ESTIBAS PB (PLATAFORMA)", equipoModelo: 1 },
    { id: 2, ordenTrabajo: "14142", modelo: "12 ESTIBAS PB (PLATAFORMA)", equipoModelo: 2 },
    { id: 3, ordenTrabajo: "14142", modelo: "12 ESTIBAS PB (PLATAFORMA)", equipoModelo: 3 },
    { id: 4, ordenTrabajo: "14142", modelo: "12 ESTIBAS PB (PLATAFORMA)", equipoModelo: 4 },
    // Orden 14141: 1 unidad
    { id: 5, ordenTrabajo: "14141", modelo: "10 ESTIBAS PB (PLATAFORMA)", equipoModelo: 1 },
    // Orden 14143: 27 unidades
    ...Array.from({ length: 27 }, (_, i) => ({
        id: 6 + i,
        ordenTrabajo: "14143",
        modelo: "12 ESTIBAS",
        equipoModelo: i + 1
    })),
    // Orden 14140: 24 unidades
    ...Array.from({ length: 24 }, (_, i) => ({
        id: 33 + i,
        ordenTrabajo: "14140",
        modelo: "10 ESTIBAS",
        equipoModelo: i + 1
    }))
];


const subassemblyTemplate = (responsable) => ({
    status: 'Pendiente', responsable, fechaCompletado: null, completadoPor: null
});

const stationTemplate = (nombre, tareas, extraFields = {}) => ({
    nombre, status: 'Pendiente', tareas: tareas.reduce((acc, t) => ({...acc, [t]: false}), {}),
    aprobadoPorCargo: null, aprobadoPorNombre: null, fechaAprobacion: null, anotacionInspeccion: '', ...extraFields
});

const getDefaultUnitStructure = (baseData) => ({
    ...baseData, 
    statusGeneral: 'Pendiente',
    isDetenido: false,
    isEntregado: false,
    fechaEntrega: null,
    responsableEntrega: '',
    recibidoPor: '',
    contratista: '', fechaInicio: '', fechaFinPrevista: '', observaciones: '',
    subensambles: { 
        acoplador: subassemblyTemplate('Jorge Forero'), 
        trenApoyo: subassemblyTemplate('Jorge Forero'), 
        tubosSuspension: subassemblyTemplate('Jorge Forero'), 
        mamparas: subassemblyTemplate('Jorge Forero'), 
        caballetes: subassemblyTemplate('Jorge Forero'), 
        puertasAbatibles: subassemblyTemplate('Carlos Colon'), 
        pisosAbatibles: subassemblyTemplate('Jorge Colon'), 
        puertasRolloUp: subassemblyTemplate('Eduardo Cadena') 
    },
    estaciones: {
        estacion1: stationTemplate('Estructura Principal (Contratistas)', ['ensamblarMonoViga', 'montarAcoplador', 'montarTrenApoyo', 'montarSuspension'], { numeroEje: '' }),
        estacion2: stationTemplate('Carrozado Inicial (Contratistas)', ['montarPuentes', 'montarLaterales', 'montarMamparas', 'montarCaballetes', 'montarMarcoTrasero', 'montarSoleras']),
        estacion3: stationTemplate('Pisos, Techos y Forros', ['montarPisos', 'montajePisosAbatibles', 'montarArcoTechos', 'instalarForroDelantero', 'instalarForrosCamaBaja', 'instalarTecho'], { tecnicoAsignado: '' }),
        estacion4: stationTemplate('Puertas y Preparación Pintura', ['instalarPuertas', 'alistarParaPintura'], { tecnicoAsignado: '' }),
        estacion5: stationTemplate('Pintura', ['aplicarFondo', 'aplicarPinturaFinal', 'controlCalidadPintura'], { tecnicoAsignado: '' }),
        estacion6: stationTemplate('Sistema Eléctrico y Neumático', ['instalarLuces', 'instalarFrenosNeumaticos'], { serialValvulaABS: '', tecnicoAsignado: '' }),
        estacion7: stationTemplate('Alistamiento Final', ['alistamientoLimpiezaFinal', 'instalarPublicidad', 'inspeccionCalidadFinal', 'instalarPlataforma'], { tecnicoAsignado: '' }),
    }
});

// --- Componentes ---
const GeminiModal = ({ title, content, onClose, isLoading }) => ( <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50"> <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg"> <div className="flex justify-between items-center mb-4"> <h3 className="text-xl font-bold text-[#0A2B4E]">{title}</h3> <button onClick={onClose} className="text-gray-500 hover:text-gray-800">&times;</button> </div> <div> {isLoading ? ( <div className="flex items-center justify-center p-4"> <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500"></div> <p className="ml-3 text-gray-700">Generando, por favor espere...</p> </div> ) : ( <p className="text-gray-700 whitespace-pre-wrap">{content}</p> )} </div> <div className="text-right mt-4"> <button onClick={onClose} className="bg-gray-200 text-gray-800 font-bold py-2 px-4 rounded-lg hover:bg-gray-300">Cerrar</button> </div> </div> </div> );
const DeliveryModal = ({ onClose, onSave }) => {
    const [deliveryData, setDeliveryData] = useState({ fecha: new Date().toISOString().slice(0, 10), responsable: '', recibe: '' });
    const handleChange = (e) => {
        const { name, value } = e.target;
        setDeliveryData(prev => ({ ...prev, [name]: value }));
    };
    const handleSave = () => {
        if (!deliveryData.fecha || !deliveryData.responsable.trim() || !deliveryData.recibe.trim()) {
            alert('Todos los campos son obligatorios.');
            return;
        }
        onSave(deliveryData);
    };
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg">
                <h3 className="text-xl font-bold text-[#0A2B4E] mb-4">Registrar Entrega de Unidad</h3>
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de Entrega</label>
                        <input type="date" name="fecha" value={deliveryData.fecha} onChange={handleChange} className="w-full p-2 border border-gray-300 rounded-md shadow-sm"/>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Responsable de la Entrega (Benfor)</label>
                        <input type="text" name="responsable" value={deliveryData.responsable} onChange={handleChange} placeholder="Nombre de quien entrega" className="w-full p-2 border border-gray-300 rounded-md shadow-sm"/>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Recibido Por (Cliente)</label>
                        <input type="text" name="recibe" value={deliveryData.recibe} onChange={handleChange} placeholder="Nombre de quien recibe" className="w-full p-2 border border-gray-300 rounded-md shadow-sm"/>
                    </div>
                </div>
                <div className="flex justify-end gap-3 mt-6">
                    <button onClick={onClose} className="bg-gray-200 text-gray-800 font-bold py-2 px-4 rounded-lg hover:bg-gray-300">Cancelar</button>
                    <button onClick={handleSave} className="bg-green-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-green-700">Guardar Entrega</button>
                </div>
            </div>
        </div>
    );
};
const ResetConfirmModal = ({ onClose, onConfirm }) => (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
        <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg">
            <h3 className="text-xl font-bold text-red-600 mb-4">Confirmar Reinicio de Unidad</h3>
            <p className="text-gray-700">¿Está seguro de que desea reiniciar esta unidad? Toda la información de progreso, aprobaciones y datos registrados se perderán y la unidad volverá a su estado inicial. Esta acción no se puede deshacer.</p>
            <div className="flex justify-end gap-3 mt-6">
                <button onClick={onClose} className="bg-gray-200 text-gray-800 font-bold py-2 px-4 rounded-lg hover:bg-gray-300">Cancelar</button>
                <button onClick={onConfirm} className="bg-red-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-red-700">Sí, Reiniciar</button>
            </div>
        </div>
    </div>
);


const LoginScreen = ({ onLogin }) => {
    const [role, setRole] = useState('Visual');
    const [title, setTitle] = useState('Jefe de Planta');
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');

    const passwordMap = {
        'Director de Manufactura': 'Raul456*012',
        'Jefe de Planta': 'Carlos789*789',
        'Coordinador de Calidad': 'Jose458*123',
        'Coordinador de Produccion': 'Oscar856*456'
    };

    const handleLogin = (e) => {
        e.preventDefault();
        setError(''); // Clear previous errors
        
        let userTitle = role;
        if (role === 'Gerencial') userTitle = 'Director de Manufactura';
        if (role === 'Usuario') userTitle = title;
        
        if (role === 'Visual') {
             onLogin({ role: 'Visual', title: 'Visual', name: 'Observador' });
             return;
        }

        if (!name.trim()) {
            setError('Por favor, digite su nombre.');
            return;
        }
        
        if (passwordMap[userTitle] !== password) {
            setError('La contraseña es incorrecta para el cargo seleccionado.');
            return;
        }

        onLogin({ role, title: userTitle, name: name.trim() });
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-100">
            <div className="p-8 bg-white rounded-xl shadow-2xl w-full max-w-md">
                <div className="text-center mb-8"><h1 className="text-[#0A2B4E] text-3xl font-bold"><span className="text-orange-500">BEN</span>FOR</h1><p className="text-gray-600 mt-2">Proyecto Postobón</p></div>
                <form onSubmit={handleLogin} className="space-y-4">
                    <div>
                        <label htmlFor="role" className="block text-sm font-medium text-gray-700 mb-1">Seleccione su Rol</label>
                        <select id="role" value={role} onChange={(e) => {setRole(e.target.value); setError('')}} className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:ring-orange-500 focus:border-orange-500">
                            <option value="Visual">Visual (Solo Consulta)</option>
                            <option value="Usuario">Inspector (Usuario)</option>
                            <option value="Gerencial">Director de Manufactura (Gerencial)</option>
                        </select>
                    </div>
                    {role === 'Usuario' && (
                        <div>
                            <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">Seleccione su Cargo</label>
                            <select id="title" value={title} onChange={(e) => {setTitle(e.target.value); setError('')}} className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:ring-orange-500 focus:border-orange-500">
                                <option value="Jefe de Planta">Jefe de Planta</option>
                                <option value="Coordinador de Calidad">Coordinador de Calidad</option>
                                <option value="Coordinador de Produccion">Coordinador de Producción</option>
                            </select>
                        </div>
                    )}
                    {(role === 'Usuario' || role === 'Gerencial') && (
                        <>
                         <div>
                            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">Digite su Nombre</label>
                            <input type="text" id="name" value={name} onChange={(e) => {setName(e.target.value); setError('')}} placeholder="Su nombre completo" className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:ring-orange-500 focus:border-orange-500" />
                        </div>
                        <div>
                            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">Contraseña</label>
                            <input type="password" id="password" value={password} onChange={(e) => {setPassword(e.target.value); setError('')}} className="w-full p-2 border border-gray-300 rounded-lg shadow-sm focus:ring-orange-500 focus:border-orange-500" />
                        </div>
                        </>
                    )}
                     {error && <p className="text-sm text-red-600 text-center">{error}</p>}
                    <button type="submit" className="w-full bg-orange-500 text-white font-bold py-3 px-4 rounded-lg hover:bg-orange-600 transition duration-300 mt-4">Ingresar</button>
                </form>
            </div>
        </div>
    );
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
    return (<div className="bg-white p-4 sm:p-6 rounded-xl shadow-lg border border-gray-200 mb-8"><h2 className="text-2xl font-bold text-[#0A2B4E] mb-4">Resumen General de Producción</h2><div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"><div className="lg:col-span-2 bg-gray-50 p-4 rounded-lg"><h3 className="font-semibold text-gray-700">Avance General (Completadas + Entregadas)</h3><div className="w-full bg-gray-200 rounded-full h-4 mt-2"><div className="bg-green-500 h-4 rounded-full" style={{ width: `${stats.progressPercentage}%` }}></div></div><p className="text-right text-lg font-bold text-gray-800 mt-1">{stats.progressPercentage.toFixed(1)}%</p><p className="text-sm text-gray-500">{stats.completedUnits + stats.deliveredUnits} de {stats.totalUnits} unidades finalizadas</p></div><div className="bg-gray-50 p-4 rounded-lg"><h3 className="font-semibold text-gray-700 mb-2">Estado de Unidades</h3><div className="flex flex-wrap gap-x-4 gap-y-1 text-sm"><span className="font-bold text-green-600">Entregadas: {stats.deliveredUnits}</span><span className="font-bold text-blue-600">En Proceso: {stats.inProgressUnits}</span><span className="font-bold text-gray-600">Pendientes: {stats.pendingUnits}</span><span className="font-bold text-red-600">Detenidas: {stats.stoppedUnits}</span></div></div><div className="bg-gray-50 p-4 rounded-lg"><h3 className="font-semibold text-gray-700 mb-2">Distribución por Contratista</h3><ul className="text-sm space-y-1">{Object.entries(stats.contractorCounts).map(([name, count]) => (<li key={name} className="flex justify-between"><span>{name}:</span><span className="font-bold">{count}</span></li>))}</ul></div></div></div>);
};

const SubassemblyItem = ({ data, onChange, disabled }) => (
    <div className="py-2 border-b border-gray-200">
        <div className="grid grid-cols-3 items-center gap-4">
            <label className="font-medium text-gray-700 col-span-1">{data.label}</label>
            <span className="text-sm text-gray-500 col-span-1">{data.responsable}</span>
            <select value={data.status} onChange={onChange} disabled={disabled} className="col-span-1 p-2 border rounded-md shadow-sm focus:ring-orange-500 focus:border-orange-500 disabled:bg-gray-100">
                <option value="Pendiente">Pendiente</option>
                <option value="En Proceso">En Proceso</option>
                <option value="Completado">Completado</option>
            </select>
        </div>
        {data.status === 'Completado' && data.completadoPor && (
            <div className="mt-2 pl-4 text-xs text-green-700">
                Aprobado por {data.completadoPor} el {new Date(data.fechaCompletado).toLocaleDateString()}
            </div>
        )}
    </div>
);
const TaskItem = ({ label, name, checked, onChange, disabled }) => (<div className="flex items-center"><input type="checkbox" id={name} name={name} checked={checked} onChange={onChange} disabled={disabled} className="h-4 w-4 text-orange-600 border-gray-300 rounded focus:ring-orange-500 disabled:bg-gray-200 disabled:cursor-not-allowed" /><label htmlFor={name} className="ml-2 block text-sm text-gray-900">{label}</label></div>);

const StationCard = ({ stationKey, stationData, isLocked, onDataChange, onApprove, onRevertApproval, user, canEdit, unitModel }) => {
    const [approvalAttempted, setApprovalAttempted] = useState(false);
    const isCompleted = stationData.status === 'Completado';
    const isApproved = stationData.status === 'Aprobado';
    const canApprove = (user.role === 'Gerencial' || user.role === 'Usuario');

    const isFieldDisabled = (fieldType = 'any') => {
        if (user.role === 'Gerencial') return false; 
        if (isLocked || !canEdit || isApproved) return true;
        if (fieldType === 'task' && isCompleted) return true;
        return false;
    };

    const isTecnicoRequired = ['estacion3', 'estacion4', 'estacion5', 'estacion6', 'estacion7'].includes(stationKey);
    const isNumeroEjeRequired = stationKey === 'estacion1';
    const isSerialValvulaABSRequired = stationKey === 'estacion6';
    
    const isApprovalDisabled = 
        (isNumeroEjeRequired && !stationData.numeroEje?.trim()) ||
        (isSerialValvulaABSRequired && !stationData.serialValvulaABS?.trim()) ||
        (isTecnicoRequired && !stationData.tecnicoAsignado?.trim());

    const tecnicoError = approvalAttempted && isTecnicoRequired && !stationData.tecnicoAsignado?.trim();
    const numeroEjeError = approvalAttempted && isNumeroEjeRequired && !stationData.numeroEje?.trim();
    const serialValvulaABSError = approvalAttempted && isSerialValvulaABSRequired && !stationData.serialValvulaABS?.trim();

    useEffect(() => {
        if (stationData.status === 'En Proceso' && !isFieldDisabled('task')) {
            const allTasksDone = Object.entries(stationData.tareas).every(([key, value]) => {
                if (key === 'instalarPlataforma' && !unitModel.includes('PLATAFORMA')) {
                    return true;
                }
                return value;
            });
            if (allTasksDone) {
                onDataChange(stationKey, 'status', 'Completado');
            }
        }
    }, [stationData.tareas, stationData.status, onDataChange, stationKey, unitModel, user.role]);

    const handleTaskToggle = (taskKey, isChecked) => {
        if (isChecked && stationData.status === 'Pendiente') {
            onDataChange(stationKey, 'status', 'En Proceso');
        }
        onDataChange(stationKey, `tareas.${taskKey}`, isChecked);
    };
    
    const handleApproveClick = () => {
        setApprovalAttempted(true);
        if (!isApprovalDisabled) {
            onApprove(stationKey);
        }
    };

    return (
        <div className={`rounded-lg shadow-md border ${isLocked && user.role !== 'Gerencial' ? 'bg-gray-100' : 'bg-white'} ${isApproved ? 'border-green-400' : 'border-gray-200'} transition-all`}>
            <div className={`p-4 ${isApproved ? 'bg-green-50' : ''}`}>
                <div className="flex justify-between items-center mb-3">
                    <h4 className="text-lg font-semibold text-gray-800">{stationData.nombre}</h4>
                    <span className={`px-3 py-1 text-sm font-semibold rounded-full ${ isApproved ? 'bg-green-200 text-green-800' : isCompleted ? 'bg-blue-200 text-blue-800' : 'bg-gray-200 text-gray-800'}`}>{stationData.status}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                    {Object.entries(stationData.tareas).map(([taskKey, taskValue]) => {
                        if (taskKey === 'instalarPlataforma' && !unitModel.includes('PLATAFORMA')) {
                            return null;
                        }
                        return (
                            <TaskItem key={taskKey} label={taskKey.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())} name={taskKey} checked={taskValue} onChange={(e) => handleTaskToggle(taskKey, e.target.checked)} disabled={isFieldDisabled('task')}/>
                        )
                    })}
                </div>
                
                <div className="mt-4 pt-4 border-t border-gray-200 space-y-3">
                    {stationData.tecnicoAsignado !== undefined && (<div><label className="block text-sm font-medium text-gray-600 mb-1">Técnico Asignado (Benfor)</label><input type="text" value={stationData.tecnicoAsignado} onChange={(e) => onDataChange(stationKey, 'tecnicoAsignado', e.target.value)} placeholder="Nombre del técnico" className={`w-full p-2 border rounded-md shadow-sm disabled:bg-gray-100 ${tecnicoError ? 'border-red-500 ring-1 ring-red-500' : 'border-gray-300'}`} disabled={isFieldDisabled()}/></div>)}
                    {stationData.numeroEje !== undefined && (<div><label className="block text-sm font-medium text-gray-600 mb-1">Número del Eje de Suspensión</label><input type="text" value={stationData.numeroEje} onChange={(e) => onDataChange(stationKey, 'numeroEje', e.target.value)} placeholder="Serial del eje" className={`w-full p-2 border rounded-md shadow-sm disabled:bg-gray-100 ${numeroEjeError ? 'border-red-500 ring-1 ring-red-500' : 'border-gray-300'}`} disabled={isFieldDisabled()}/></div>)}
                    {stationData.serialValvulaABS !== undefined && (<div><label className="block text-sm font-medium text-gray-600 mb-1">Serial Válvula ABS</label><input type="text" value={stationData.serialValvulaABS} onChange={(e) => onDataChange(stationKey, 'serialValvulaABS', e.target.value)} placeholder="Serial de la válvula" className={`w-full p-2 border rounded-md shadow-sm disabled:bg-gray-100 ${serialValvulaABSError ? 'border-red-500 ring-1 ring-red-500' : 'border-gray-300'}`} disabled={isFieldDisabled()}/></div>)}
                    <div><label className="block text-sm font-medium text-gray-600 mb-1">Anotaciones de la Estación</label><textarea value={stationData.anotacionInspeccion} onChange={(e) => onDataChange(stationKey, 'anotacionInspeccion', e.target.value)} rows="2" placeholder="Dejar una nota si es necesario..." className="w-full p-2 border border-gray-300 rounded-md shadow-sm disabled:bg-gray-100" disabled={isFieldDisabled()}></textarea></div>
                </div>
            </div>
            { (isCompleted || isApproved) && (
                 <div className="bg-gray-50 p-4 border-t border-gray-200">
                     <h5 className="font-semibold text-gray-700 mb-2">Aprobación Final</h5>
                     {isCompleted && !isApproved && (
                         <div>
                            {canApprove ? (
                                <button onClick={handleApproveClick} className="bg-green-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-green-700 disabled:bg-green-300 disabled:cursor-not-allowed" title={isApprovalDisabled ? "Complete los campos requeridos para aprobar" : "Aprobar Estación"}>Aprobar Estación</button>
                            ) : (<p className="text-sm text-yellow-700">Esperando aprobación del personal autorizado.</p>)}
                            {approvalAttempted && isApprovalDisabled && canApprove && <p className="text-xs text-red-600 mt-1">Debe registrar los datos requeridos antes de aprobar.</p>}
                         </div>
                    )}
                     {isApproved && (<div className="text-sm text-green-800 space-y-2">
                        <p>Aprobado por: <strong>{stationData.aprobadoPorNombre}</strong> ({stationData.aprobadoPorCargo})</p>
                        <p>Fecha: {new Date(stationData.fechaAprobacion).toLocaleString()}</p>
                        {user.role === 'Gerencial' && <button onClick={() => onRevertApproval(stationKey)} className="text-xs bg-yellow-400 text-yellow-900 font-semibold py-1 px-3 rounded-lg hover:bg-yellow-500">Deshacer Aprobación</button>}
                    </div>)}
                 </div>
            )}
        </div>
    );
};

const UnitForm = ({ unit, onUpdate, onBack, user }) => {
    const [formData, setFormData] = useState(unit);
    const [isSaving, setIsSaving] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [showGeminiModal, setShowGeminiModal] = useState(false);
    const [showDeliveryModal, setShowDeliveryModal] = useState(false);
    const [showResetModal, setShowResetModal] = useState(false);
    const [modalContent, setModalContent] = useState('');
    const [modalTitle, setModalTitle] = useState('');
    const [contractorError, setContractorError] = useState(false);

    const isReadOnly = user.role === 'Visual';
    const canEdit = user.role === 'Gerencial' || user.role === 'Usuario';

    const displayStatus = useMemo(() => getUnitDisplayStatus(formData), [formData]);
    const isCompleted = displayStatus === 'Completado';

    const stationOrder = useMemo(() => ['estacion1', 'estacion2', 'estacion3', 'estacion4', 'estacion5', 'estacion6', 'estacion7'], []);

    useEffect(() => { setFormData(unit); }, [unit]);

    useEffect(() => {
        if (unit.isEntregado || unit.isDetenido || user.role === 'Gerencial') return;
        
        const lastStationApproved = unit.estaciones.estacion7.status === 'Aprobado';
        const anyStationActive = Object.values(unit.estaciones).some(s => s.status !== 'Pendiente');
        let newComputedStatus = 'Pendiente';

        if (lastStationApproved) {
            newComputedStatus = 'Completado';
        } else if (anyStationActive) {
            newComputedStatus = 'En Proceso';
        }
        
        if (newComputedStatus !== unit.statusGeneral) {
            setFormData(prev => ({...prev, statusGeneral: newComputedStatus}));
        }

    }, [unit.estaciones, unit.isDetenido, unit.isEntregado, unit.statusGeneral, user.role]);
    
    const callGeminiAPI = async (prompt) => { /* ... (no changes) ... */ };
    const handleSuggestNextStep = async () => { /* ... (no changes) ... */ };
    const handleGenerateReport = async () => { /* ... (no changes) ... */ };
    
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

    const handleToggleDetenido = () => {
        setFormData(prev => ({...prev, isDetenido: !prev.isDetenido }));
    };

    const handleSaveDelivery = (deliveryData) => {
        setFormData(prev => ({
            ...prev,
            isEntregado: true,
            isDetenido: false,
            fechaEntrega: deliveryData.fecha,
            responsableEntrega: deliveryData.responsable,
            recibidoPor: deliveryData.recibe,
            statusGeneral: 'Entregado'
        }));
        setShowDeliveryModal(false);
    };

    const handleResetUnit = async () => {
        const baseData = {
            id: formData.id,
            ordenTrabajo: formData.ordenTrabajo,
            modelo: formData.modelo,
            equipoModelo: formData.equipoModelo,
        };
        const resetData = getDefaultUnitStructure(baseData);
        await onUpdate(resetData);
        setShowResetModal(false);
    };

    const handleSave = async () => { 
        if (!canEdit) return; 

        const anyStationStarted = Object.values(formData.estaciones).some(station => station.status !== 'Pendiente');
        if (anyStationStarted && !formData.contratista) {
            alert('Debe asignar un contratista antes de guardar el progreso.');
            setContractorError(true);
            return; 
        }

        setContractorError(false);
        setIsSaving(true); 
        await onUpdate(formData); 
        setIsSaving(false); 
    };
    const handlePrint = () => { window.print(); };
    if (!formData) return <div>Cargando datos de la unidad...</div>;
    return (
        <div className="p-4 sm:p-6 lg:p-8 printable-content">
            {showGeminiModal && <GeminiModal title={modalTitle} content={modalContent} isLoading={isGenerating} onClose={() => setShowGeminiModal(false)} />}
            {showDeliveryModal && <DeliveryModal onClose={() => setShowDeliveryModal(false)} onSave={handleSaveDelivery} />}
            {showResetModal && <ResetConfirmModal onClose={() => setShowResetModal(false)} onConfirm={handleResetUnit} />}
            <style>{`@media print { /* ... (no changes) ... */ }`}</style>
            <div className="flex justify-between items-center mb-6 no-print"> <button onClick={onBack} className="bg-gray-200 text-gray-800 font-bold py-2 px-4 rounded-lg hover:bg-gray-300">&larr; Volver</button> <div className="flex flex-wrap gap-2"> <button onClick={handleSuggestNextStep} disabled={isGenerating} className="bg-purple-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-purple-700 disabled:bg-purple-300">✨ Sugerir Próximo Paso</button> <button onClick={handlePrint} className="bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700">Imprimir</button> {canEdit && (<button onClick={handleSave} disabled={isSaving || isReadOnly} className="bg-orange-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-orange-600 disabled:bg-orange-300">{isSaving ? 'Guardando...' : 'Guardar Cambios'}</button>)} </div> </div>
            <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-200 mb-6">
                <div className="flex justify-between items-start">
                    <h2 className="text-2xl font-bold text-[#0A2B4E] mb-4">Unidad #{formData.id}</h2>
                    <div className="flex items-center gap-4">
                        <span className={`px-3 py-1 text-lg font-bold rounded-full text-white ${getStatusColor(displayStatus)}`}>{displayStatus}</span>
                        {canEdit && !formData.isEntregado && (
                            <button onClick={handleToggleDetenido} className={`font-bold py-2 px-4 rounded-lg ${formData.isDetenido ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-red-500 hover:bg-red-600'} text-white`}>
                                {formData.isDetenido ? 'Reanudar' : 'Poner en Detenido'}
                            </button>
                        )}
                         {canEdit && isCompleted && !formData.isEntregado && (
                            <button onClick={() => setShowDeliveryModal(true)} className="bg-green-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-green-700">Registrar Entrega</button>
                         )}
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-4"><div><span className="font-semibold">OT:</span> {formData.ordenTrabajo}</div><div><span className="font-semibold">Modelo:</span> {formData.modelo}</div><div><span className="font-semibold">Equipo:</span> {formData.equipoModelo}</div><div><label className="font-semibold mr-2">Contratista:</label><select name="contratista" value={formData.contratista} onChange={(e) => {handleChange(e); setContractorError(false);}} disabled={isReadOnly || formData.isEntregado} className={`p-2 border rounded-md shadow-sm disabled:bg-gray-100 ${contractorError ? 'border-red-500 ring-1 ring-red-500' : 'border-gray-300'}`}><option value="">Sin Asignar</option><option>Wilder Martinez</option><option>Henrry Tapias</option><option>Sanabria</option><option>Rubén Torres</option></select></div></div>
                {formData.isEntregado && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                         <h4 className="text-lg font-semibold text-gray-800">Detalles de Entrega</h4>
                         <p><strong>Fecha:</strong> {new Date(formData.fechaEntrega).toLocaleDateString()}</p>
                         <p><strong>Entregado por:</strong> {formData.responsableEntrega}</p>
                         <p><strong>Recibido por:</strong> {formData.recibidoPor}</p>
                    </div>
                )}
            </div>
            <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-200 mb-6"><h3 className="text-xl font-bold text-[#0A2B4E] mb-4">Subensambles</h3>
                {Object.entries({acoplador: 'Acoplador', trenApoyo: 'Tren de Apoyo', tubosSuspension: 'Tubos Suspensión', mamparas: 'Mamparas', caballetes: 'Caballetes', puertasAbatibles: 'Puertas Abatibles', pisosAbatibles: 'Pisos Abatibles', puertasRolloUp: 'Puertas Rollo Up'})
                .map(([key, label]) => {
                    const subassembly = formData.subensambles[key];
                    const isDisabled = isReadOnly || formData.isEntregado || (user.role === 'Usuario' && subassembly.status === 'Completado');
                    return (
                       <SubassemblyItem key={key} data={{label, ...subassembly}} onChange={(e) => handleSubassemblyChange(key, e.target.value)} disabled={isDisabled}/>
                    )
                })}
            </div>
            <div className="space-y-6"><h3 className="text-xl font-bold text-[#0A2B4E] mb-4">Línea de Ensamble y Acabados</h3>{stationOrder.map((key, index) => { const isLocked = index > 0 && formData.estaciones[stationOrder[index-1]].status !== 'Aprobado'; return (<StationCard key={key} stationKey={key} stationData={formData.estaciones[key]} isLocked={isLocked || formData.isEntregado} onDataChange={handleStationDataChange} onApprove={handleApproveStation} onRevertApproval={handleRevertApproval} user={user} canEdit={canEdit} unitModel={formData.modelo} />);})}</div>
            <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-200 mt-6"><div className="flex justify-between items-center mb-4"><h3 className="text-xl font-bold text-[#0A2B4E]">Observaciones y Novedades</h3>{canEdit && <button onClick={handleGenerateReport} disabled={isGenerating} className="bg-teal-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-teal-700 disabled:bg-teal-300">✨ Generar Reporte</button>}</div><textarea name="observaciones" value={formData.observaciones} onChange={handleChange} rows="4" disabled={isReadOnly || formData.isEntregado} className="w-full p-2 border rounded-md shadow-sm disabled:bg-gray-100" placeholder="..."></textarea></div>
            {user.role === 'Gerencial' && !formData.isEntregado && (
                <div className="mt-8 pt-6 border-t-2 border-red-300 text-center">
                    <button onClick={() => setShowResetModal(true)} className="bg-red-700 text-white font-bold py-2 px-6 rounded-lg hover:bg-red-800">Reiniciar Unidad</button>
                    <p className="text-xs text-gray-600 mt-2">Esta acción devolverá la unidad a su estado inicial. Úselo con precaución.</p>
                </div>
            )}
        </div>
    );
};

const getUnitDisplayStatus = (unit) => {
    if (unit.isEntregado) return 'Entregado';
    if (unit.isDetenido) return 'Detenido';
    if (unit.estaciones?.estacion7?.status === 'Aprobado') return 'Completado';
    const anyStationActive = Object.values(unit.estaciones || {}).some(s => s.status !== 'Pendiente');
    if (anyStationActive) return 'En Proceso';
    return 'Pendiente';
};

const getStatusColor = (status) => {
    switch (status) {
        case 'Entregado': return 'bg-purple-600';
        case 'Completado': return 'bg-green-500';
        case 'En Proceso': return 'bg-blue-500';
        case 'Detenido': return 'bg-red-500';
        default: return 'bg-gray-400';
    }
};

const UnitList = ({ units, onSelectUnit }) => { 
    const calculateProgress = (unit) => {
        const approvedStations = Object.values(unit.estaciones).filter(s => s.status === 'Aprobado').length;
        const totalStations = Object.keys(unit.estaciones).length;
        return totalStations > 0 ? (approvedStations / totalStations) * 100 : 0;
    };
    return (
        <div className="p-4 sm:p-6 lg:p-8">
            <Dashboard units={units} />
            <h1 className="text-3xl font-bold text-[#0A2B4E] mb-6">Lista de Unidades</h1>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                {units.map(unit => {
                    const progress = calculateProgress(unit);
                    const displayStatus = getUnitDisplayStatus(unit);
                    return (
                        <div key={unit.id} onClick={() => onSelectUnit(unit.id)} className="bg-white rounded-xl shadow-lg border border-gray-200 flex flex-col justify-between cursor-pointer hover:shadow-2xl hover:-translate-y-1 transition-all duration-300">
                            <div className="p-4">
                                <div className="flex justify-between items-start"><span className="font-bold text-lg text-[#0A2B4E]">Unidad #{unit.id}</span><div className={`w-4 h-4 rounded-full ${getStatusColor(displayStatus)}`}></div></div>
                                <p className="text-sm text-gray-600 mt-2">OT: {unit.ordenTrabajo}</p>
                                <p className="text-md font-semibold text-gray-800 mt-1">{unit.modelo}</p>
                                <p className="text-xs text-gray-500 mt-2">Contratista: {unit.contratista || 'N/A'}</p>
                                <div className="mt-4 pt-2 border-t border-gray-200"><span className={`text-sm font-medium px-2 py-1 rounded-full ${getStatusColor(displayStatus)} text-white`}>{displayStatus}</span></div>
                            </div>
                            <div className="px-4 pb-4">
                                <p className="text-xs text-gray-500 mb-1">Avance en Planta</p>
                                <div className="w-full bg-gray-200 rounded-full h-2.5"><div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${progress}%` }}></div></div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const App = () => {
    const [currentUser, setCurrentUser] = useState(null);
    const [view, setView] = useState('list');
    const [units, setUnits] = useState([]);
    const [selectedUnitId, setSelectedUnitId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [db, setDb] = useState(null);
    const [authReady, setAuthReady] = useState(false);

    useEffect(() => { try { if (Object.keys(firebaseConfig).length > 1 && firebaseConfig.apiKey !== "TU_API_KEY_AQUI") { const app = initializeApp(firebaseConfig); const firestoreDb = getFirestore(app); const firebaseAuth = getAuth(app); setDb(firestoreDb); onAuthStateChanged(firebaseAuth, async (user) => { if (!user) { await signInAnonymously(firebaseAuth).catch(e => console.error(e)); } setAuthReady(true); }); } else { console.log("Firebase config not found, running in local mode."); setAuthReady(true); } } catch (e) { console.error("Error al inicializar Firebase:", e); setError("No se pudo conectar con la base de datos."); setLoading(false); } }, []);
    
    const seedDatabase = useCallback(async (firestoreDb) => {
        if (!firestoreDb) return;
        const unitsCollectionRef = collection(firestoreDb, `artifacts/${appIdForPath}/public/data/units`);
        const collectionSnap = await getDocs(unitsCollectionRef);

        if (collectionSnap.size !== initialUnitsData.length) {
             console.log("Detectada una discrepancia en el número de unidades. Reinicializando la base de datos...");
            const batch = writeBatch(firestoreDb);
            
             collectionSnap.docs.forEach(doc => {
                 batch.delete(doc.ref);
             });

            initialUnitsData.forEach(unitBase => { 
                const unitData = getDefaultUnitStructure(unitBase); 
                const unitRef = doc(firestoreDb, `artifacts/${appIdForPath}/public/data/units`, `${unitData.id}`); 
                batch.set(unitRef, unitData); 
            });
            await batch.commit();
            console.log("Base de datos reinicializada con 56 unidades.");
        }
    }, []);

    useEffect(() => {
        if (!authReady || !db || !currentUser) return;
        setLoading(true);
        const setupListener = async () => {
            await seedDatabase(db);
            const unitsCollection = collection(db, `artifacts/${appIdForPath}/public/data/units`);
            const q = query(unitsCollection);
            const unsubscribe = onSnapshot(q, (querySnapshot) => {
                const unitsData = [];
                querySnapshot.forEach((doc) => { unitsData.push({ id: doc.id, ...doc.data() }); });
                unitsData.sort((a, b) => parseInt(a.id) - parseInt(b.id));
                setUnits(unitsData);
                setLoading(false);
            }, (err) => { console.error("Error escuchando cambios:", err); setError("Error al obtener los datos en tiempo real."); setLoading(false); });
            return () => unsubscribe();
        };
        setupListener();
    }, [authReady, db, seedDatabase, currentUser]);

    const handleLogin = (user) => { setCurrentUser(user); };
    const handleLogout = () => { setCurrentUser(null); setView('list'); setSelectedUnitId(null); };
    const handleSelectUnit = (unitId) => { setSelectedUnitId(unitId); setView('form'); };
    const handleBackToList = () => { setSelectedUnitId(null); setView('list'); };
    const handleUpdateUnit = async (updatedUnitData) => {
        if (!db) { return; }
        if (currentUser.role === 'Visual') { setError("No tiene permiso para guardar cambios."); return; }
        try { const unitRef = doc(db, `artifacts/${appIdForPath}/public/data/units`, `${updatedUnitData.id}`); await updateDoc(unitRef, updatedUnitData); } catch (e) { console.error("Error al actualizar la unidad:", e); setError("No se pudieron guardar los cambios en la base de datos."); }
    };
    
    if (!currentUser) { return <LoginScreen onLogin={handleLogin} />; }

    return (
        <div className="bg-gray-100 min-h-screen font-sans">
            <header className="bg-[#0A2B4E] p-4 shadow-md no-print"><div className="container mx-auto flex justify-between items-center"><div><h1 className="text-white text-2xl font-bold"><span className="text-orange-500">BEN</span>FOR</h1><p className="text-white text-sm">Proyecto Postobón</p></div><div className="text-white text-right"><span className="block text-sm font-medium">{currentUser.name}</span><span className="block text-xs opacity-80">{currentUser.title}</span><button onClick={handleLogout} className="text-sm text-orange-400 hover:text-orange-300 mt-1">Cerrar Sesión</button></div></div></header>
            <main className="container mx-auto">
                {loading && currentUser && <div className="text-center p-10">Cargando datos...</div>}
                {error && <div className="text-center p-10 text-red-500">{error}</div>}
                {!loading && !error && (<>
                    {view === 'list' && <UnitList units={units} onSelectUnit={handleSelectUnit} />}
                    {view === 'form' && selectedUnitId && (<UnitForm unit={units.find(u => u.id == selectedUnitId)} onUpdate={handleUpdateUnit} onBack={handleBackToList} user={currentUser} />)}
                </>)}
            </main>
            <footer className="text-center py-4 text-gray-500 text-xs no-print"><p>&copy; {new Date().getFullYear()} Benfor. Todos los derechos reservados.</p></footer>
        </div>
    );
};

export default App;
