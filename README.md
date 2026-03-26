# Finance Dashboard

A local-first personal finance dashboard with CSV import, automatic categorization, and analytics.

## Prerequisites
- Python 3.11+ (conda env `finenv` recommended)
- Node.js 18+
- npm 9+

## Quick Start

```bash
bash start.sh
```

Then open **http://localhost:5173**

## Manual Setup

### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Usage

### 1. Import Bank Transactions
1. Go to **Importer** page
2. Drag and drop a CSV export from your bank
3. Review the auto-detected bank profile and column mapping
4. Check the 20-row preview, then click **Confirmer l'import**

### 2. Categorize Transactions
- Rules-based categorization runs automatically on import
- Edit categories inline in the **Transactions** page
- Train the ML model in **Paramètres → Modèle ML** for improved accuracy

### 3. Analyze Your Finances
- **Dashboard**: KPI cards + charts for the selected period
- **Analyses**: Deep-dive with period comparison

### 4. Manage Settings
- **Paramètres → Catégories**: Add/edit spending categories
- **Paramètres → Règles**: Keyword-based categorization rules
- **Paramètres → Profils bancaires**: Bank CSV format profiles

## Supported Banks
- Generic (auto-detection)
- BNP Paribas
- Crédit Agricole
- Boursorama
- Société Générale
- LCL

## Tech Stack
- **Backend**: FastAPI, SQLAlchemy (async), SQLite, scikit-learn
- **Frontend**: React, TypeScript, Vite, Tailwind CSS, Recharts, AG Grid, Zustand
