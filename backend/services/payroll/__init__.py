"""Salaire & impôts: payslips read from PDFs, situations ("packs"), and the
deposit each payslip is matched with in the bank.

- `packs.py`    what a situation is (France, Zurich): its settings and widgets.
- `vocab.py`    the line vocabulary of each pack: which label is which kind.
- `reading.py`  a PDF's text → a payslip proposal, checked, never saved.
- `matching.py` the salary deposit of each payslip, computed on read.

Nothing here logs a label, an amount or a document's text: payslips carry a
name, an address, a social security number and a salary.
"""
