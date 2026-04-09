import sys
import os

files_to_fix = ['api/admin/discover-keywords.ts', 'api/cron/daily-digest.ts']

for file in files_to_fix:
    with open(file, 'r', encoding='utf-8') as f:
        content = f.read()

    # Powershell/Prompt issues where backslashes were literally inserted:
    # `\` replaced with ```
    # `\${` replaced with `${`
    content = content.replace('\\`', '`').replace('\\${', '${')

    with open(file, 'w', encoding='utf-8') as f:
        f.write(content)

print("Files fixed.")
