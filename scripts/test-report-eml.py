"""Parse a real browser-generated EML with Python's independent MIME parser."""
import re
from email import policy
from email.parser import BytesParser
from pathlib import Path

folder = Path(__file__).resolve().parent.parent / '.dev' / 'reports'
message = BytesParser(policy=policy.default).parsebytes((folder / 'ventas-draft.eml').read_bytes())
assert message['X-Unsent'] == '1'
assert str(message['To']) == 'review@example.com'
assert str(message['Cc']) == 'control@example.com'
assert str(message['Subject']) == 'Reporte diario de ventas'
assert not message.defects
html_parts = [part for part in message.walk() if part.get_content_type() == 'text/html']
body = next(part for part in html_parts if part.get_content_disposition() != 'attachment').get_content()
assert 'Reporte para revisión.' in body
assert '<script' not in body and '<canvas' not in body and 'display: grid' not in body
inline = {part['Content-ID'].strip('<>'): part for part in message.walk() if part['Content-ID']}
assert len(inline) == 2
assert set(re.findall(r'cid:([^"\s<>]+)', body)) == set(inline)
assert all(part.get_payload(decode=True).startswith(b'\x89PNG\r\n\x1a\n') for part in inline.values())
attachment = next(part for part in message.iter_attachments() if part.get_filename() == 'report.html')
assert attachment.get_payload(decode=True) == (folder / 'ventas-interactive.html').read_bytes()
assert 'connectionId' not in attachment.get_content()
print('Report EML OK: MIME decoded independently, Unicode subject/message, recipients, two inline PNG/CIDs and byte-identical offline HTML attachment; draft only')
