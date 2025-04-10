#!/usr/bin/env python3
import argparse
import sys
import os
from pathlib import Path
from bs4 import BeautifulSoup
from typing import Union # Added for ClientTransaction hint if needed later

from .transaction import ClientTransaction

DEFAULT_METHOD = "POST"
DEFAULT_PATH = "/1.1/jot/client_event.json"

def generate_transaction_id(
    method: str, 
    path: str, 
    html_content: str # No longer Optional
) -> str:   
    """Generates the X client transaction ID."""
    response_obj = BeautifulSoup(html_content, 'lxml')

    ct = ClientTransaction(response_obj)
    transaction_id = ct.generate_transaction_id(method=method, path=path)
    return transaction_id

def main():
    parser = argparse.ArgumentParser(description="Generate X client transaction ID from a local HTML file.")
    _=parser.add_argument(
        "--method", 
        default=DEFAULT_METHOD, 
        help=f"HTTP method (default: {DEFAULT_METHOD})"
    )
    _=parser.add_argument(
        "--path", 
        default=DEFAULT_PATH, 
        help=f"Request path (default: {DEFAULT_PATH})"
    )
    _=parser.add_argument(
        "--html-file",
        type=Path,
        required=True, # Make argument required
        help="Path to the HTML file containing the page source"
    )
    
    args = parser.parse_args()

    # Read HTML content (file existence checked by argparse type=Path)
    try:
        if not args.html_file.is_file():
            # This check might be redundant if Path checks existence, 
            # but good for explicit error message
            print(f"Error: HTML file not found or is not a file: {args.html_file}")
            exit(1)
        html_content = args.html_file.read_text(encoding='utf-8')
    except Exception as e:
        print(f"Error reading HTML file {args.html_file}: {e}")
        exit(1)

    try:
        transaction_id = generate_transaction_id(
            method=args.method, 
            path=args.path,
            html_content=html_content # Pass the read content
        )
        print(transaction_id)
    except Exception as e:
        print(f"Error generating transaction ID: {e}")
        exit(1)

if __name__ == "__main__":
    main()
