
import os
import filecmp
import sys
import subprocess

codes = {200: 'success', 404: 'file not found', 400: 'error', 408: 'timeout'}

def compile(file, lang):
    if lang in ('python', 'javascript'):
        return 200  # No compilation needed for Python or JavaScript

    if os.path.isfile(file):
        if lang == 'c':
            result = os.system(f'gcc {file}')
        elif lang == 'cpp':
            result = os.system(f'g++ {file}')
        elif lang == 'java':
            result = os.system(f'javac {file}')
        elif lang == 'csharp':
            project_name = 'TempCSharpProject'
            # Create and compile C# project
            subprocess.run(['dotnet', 'new', 'console', '-o', project_name,'--force'], check=True)
            os.system(f'cp {file} {project_name}/Program.cs')
            result = subprocess.run(['dotnet', 'build'], cwd=project_name).returncode
            if result != 0:
                return 400  # Compilation failed

            exe_file = f'{project_name}/bin/Debug/net6.0/{project_name}.dll'
            if os.path.isfile(exe_file):
                return 200
            else:
                return 400  # Compiled file not found

        if (lang == 'java' and os.path.isfile(file.replace('.java', '.class'))) or \
           (lang in ['c', 'cpp'] and os.path.isfile('a.out')): 
            return 200

        return 400  # Compilation error
    return 404  # File not found

def run(file, input, timeout, lang):
    cmd = ''
    if lang == 'java':
        cmd = f'java {file.replace(".java", "")}'
    elif lang in ('c', 'cpp'):
        cmd = './a.out'
    elif lang == 'python':
        cmd = f'python3 {file}'
    elif lang == 'javascript':
        cmd = f'node {file}'
    elif lang == 'csharp':
        project_name = 'TempCSharpProject'
        cmd = f'dotnet run --project {project_name}'

    r = os.system(f'timeout {timeout} {cmd} < {input} > {testout}')
    return {0: 200, 31744: 408}.get(r, 400)
    # try:
    #     with open(input, "r") as infile, open(testout, "w") as outfile:
    #         # Run the command with timeout
    #         subprocess.run(cmd, stdin=infile, stdout=outfile, stderr=subprocess.PIPE, shell=True, timeout=int(timeout))
    #     return 200  # Success
    # except subprocess.TimeoutExpired:
    #     return 408  # Timeout
    # except subprocess.CalledProcessError as e:
    #     print(f"Command failed with error: {e}")
    #     return 400
    # except Exception as e:
    #     print(f"Error: {e}")
    #     return 400  # General Error

def match(output):
    if os.path.isfile('out.txt') and os.path.isfile(output):
        b = filecmp.cmp('out.txt', output)
        os.remove('out.txt')
        return b
    return 404

# Main Execution
params = sys.argv
file = params[1].split('/')[-1]
folder = params[1].split('/')[-2]
path = f'../temp/{folder}/'

os.chdir(path)
lang = params[2]
timeout = str(min(15, int(params[3])))

testin = "input.txt"
testout = f"output{params[4]}.txt"
status = compile(file, lang)
if status == 200:
    status = run(file, testin, timeout, lang)

print(codes[status])


