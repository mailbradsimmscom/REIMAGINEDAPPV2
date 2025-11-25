#!/usr/bin/env python3
"""
Quick script to analyze the Supply Sheet Excel file
"""
import pandas as pd
import sys

excel_file = '/Users/brad/code/REIMAGINEDAPPV2/code updates/Supply Sheet.xlsx'

try:
    # Read Excel file
    df = pd.read_excel(excel_file)

    print(f"Total rows: {len(df)}")
    print(f"Total columns: {len(df.columns)}")
    print("\nColumns:")
    for i, col in enumerate(df.columns, 1):
        print(f"  {i}. {col}")

    print("\n" + "="*80)
    print("FIRST 30 ROWS:")
    print("="*80)

    # Show first 30 rows with all columns
    pd.set_option('display.max_columns', None)
    pd.set_option('display.width', None)
    pd.set_option('display.max_colwidth', 50)

    print(df.head(30).to_string())

    print("\n" + "="*80)
    print("SAMPLE DATA ANALYSIS:")
    print("="*80)

    # Check for null values
    print("\nNull values per column:")
    for col in df.columns:
        null_count = df[col].isnull().sum()
        if null_count > 0:
            print(f"  {col}: {null_count} null values")

    # Show unique values for key columns (if they exist)
    if 'Qty' in df.columns:
        print("\nUnique Qty values (first 20):")
        unique_qty = df['Qty'].dropna().unique()[:20]
        for val in unique_qty:
            print(f"  - {val}")

    if 'Location' in df.columns:
        print("\nUnique Locations:")
        unique_locations = df['Location'].dropna().unique()
        for loc in unique_locations:
            print(f"  - {loc}")

    print("\n" + "="*80)
    print("ROWS 31-60 (if they exist):")
    print("="*80)
    if len(df) > 30:
        print(df.iloc[30:60].to_string())
    else:
        print("(No more rows)")

except Exception as e:
    print(f"Error reading Excel file: {e}")
    sys.exit(1)
