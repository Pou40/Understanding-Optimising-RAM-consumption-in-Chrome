from flask import Flask, request, jsonify
import csv
import os
import psutil
import time
import threading
from collections import defaultdict

app = Flask(__name__)
csv_file = "user_data.csv"

# Initialize CSV file with headers if it doesn't exist
if not os.path.exists(csv_file):
    with open(csv_file, mode='w', newline='') as file:
        writer = csv.writer(file)
        writer.writerow(["timestamp", "type", "data"])

@app.route('/log', methods=['POST'])
def log_data():
    data = request.get_json()
    # Create a readable timestamp for the log
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())
    
    # Write the logged data as a row in the CSV file
    with open(csv_file, mode='a', newline='') as file:
        writer = csv.writer(file)
        # Store entire 'data' object in the "data" field
        writer.writerow([timestamp, data.get("type", "unknown"), data])
    
    return jsonify({"status": "success"}), 200


def log_resource_usage():
    """
    Periodically logs Chrome's total RAM usage, CPU usage, 
    and optional system metrics to the CSV.
    """
    # For optional network usage tracking
    # We'll track total before/after values to compute deltas
    last_net = psutil.net_io_counters()

    while True:
        # 1) Memory and CPU usage for all "chrome" processes
        total_memory = 0
        total_cpu = 0.0
        process_count = 0
        for proc in psutil.process_iter(['name', 'memory_info', 'cpu_percent']):
            # try:
            #     if proc.info['name'] and "chrome" in proc.info['name'].lower():
            #         # Memory usage in bytes (RSS)
            #         total_memory += proc.info['memory_info'].rss
            #         # CPU usage is the % since last call to cpu_percent (per process)
            #         # You can call proc.cpu_percent(interval=some_time), but that's blocking
            #         # Using the immediate .info['cpu_percent'] from psutil
            #         total_cpu += proc.info['cpu_percent']
            #         process_count += 1
            # except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            #     continue

            try:
                if proc.info['name'] and 'chrome' in proc.info['name'].lower():
                    try:
                        full_mem = proc.memory_full_info()
                        total_memory += full_mem.uss  # More accurate unique memory
                        total_cpu += proc.info.get('cpu_percent', 0.0)
                        process_count += 1
                    except psutil.AccessDenied:
                        # Fall back to regular memory_info if access denied

                        print("\n\n Access Denied to full memory info for process: ", proc.info['name'], "\n\n")
                        mem = proc.info.get('memory_info')
                        if mem:
                            total_memory += mem.rss



                    # mem = proc.info.get('memory_info')
                    # if mem and hasattr(mem, 'rss'):
                    #     total_memory += mem.rss
                    #     total_cpu    += proc.info.get('cpu_percent', 0.0)
                    #     process_count += 1
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                continue
        # 2) System-wide usage (optional)
        system_memory = psutil.virtual_memory().used     # total system memory used (in bytes)
        system_cpu = psutil.cpu_percent(interval=None)   # % CPU usage since last call
        chrome_net_io = None
        
        # 3) Network usage (optional) - we can track the difference in total I/O since last cycle
        current_net = psutil.net_io_counters()
        sent_delta = current_net.bytes_sent - last_net.bytes_sent
        recv_delta = current_net.bytes_recv - last_net.bytes_recv
        last_net = current_net

        # If you only want Chrome-specific network usage, you'd need to sum from each Chrome process.
        # psutil does not reliably provide per-process network data on all OSes, so this is OS-dependent.
        
        # Prepare the dictionary to log
        usage_data = {
            "type": "resourceUsage",
            "chrome_memory_bytes": total_memory,
            "chrome_cpu_percent_sum": total_cpu,  # sum of CPU % across all Chrome processes
            "chrome_process_count": process_count,
            "system_memory_used_bytes": system_memory,
            "system_cpu_percent": system_cpu,
            "net_bytes_sent_delta": sent_delta,
            "net_bytes_recv_delta": recv_delta
        }

        # Append a row to CSV
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())
        with open(csv_file, mode='a', newline='') as file:
            writer = csv.writer(file)
            writer.writerow([timestamp, usage_data["type"], usage_data])

        # Sleep for a while before logging again
        time.sleep(30)  # adjust as needed

# def log_resource_usage():
#     """
#     Periodically logs Chrome's total RAM usage, CPU usage, 
#     and optional system metrics to the CSV with improved accuracy.
#     """
#     # For optional network usage tracking
#     last_net = psutil.net_io_counters()

#     while True:
#         try:
#             # 1) Get all Chrome processes with better filtering and deduplication
#             chrome_processes = {}
#             chrome_process_names = [
#                 'chrome', 'chrome.exe', 'chromium', 'chromium.exe',
#                 'google chrome', 'google-chrome', 'chrome_crashpad_handler'
#             ]
            
#             # Collect unique Chrome processes by PID to avoid duplicates
#             for proc in psutil.process_iter(['pid', 'name', 'exe']):
#                 try:
#                     proc_info = proc.info
#                     proc_name = proc_info.get('name', '').lower()
#                     proc_exe = proc_info.get('exe', '').lower() if proc_info.get('exe') else ''
                    
#                     # Check if it's a Chrome process
#                     is_chrome = any(chrome_name in proc_name for chrome_name in chrome_process_names)
#                     is_chrome = is_chrome or 'chrome' in proc_exe
                    
#                     if is_chrome and proc_info['pid'] not in chrome_processes:
#                         chrome_processes[proc_info['pid']] = proc
                        
#                 except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
#                     continue
            
#             # 2) Calculate memory and CPU usage more accurately
#             total_memory = 0
#             total_cpu = 0.0
#             process_count = len(chrome_processes)
#             memory_breakdown = defaultdict(int)
            
#             for pid, proc in chrome_processes.items():
#                 try:
#                     # Use USS (Unique Set Size) when available for more accurate memory accounting
#                     try:
#                         mem_full = proc.memory_full_info()
#                         # USS is unique memory that would be freed if process terminates
#                         unique_mem = mem_full.uss
#                         total_memory += unique_mem
#                         memory_breakdown['uss'] += unique_mem
#                     except (psutil.AccessDenied, AttributeError):
#                         # Fallback to PSS (Proportional Set Size) if available
#                         try:
#                             pss_mem = getattr(proc.memory_full_info(), 'pss', None)
#                             if pss_mem:
#                                 total_memory += pss_mem
#                                 memory_breakdown['pss'] += pss_mem
#                             else:
#                                 # Final fallback to RSS but account for it differently
#                                 rss_mem = proc.memory_info().rss
#                                 # For RSS, we'll use a more conservative estimate
#                                 total_memory += rss_mem
#                                 memory_breakdown['rss'] += rss_mem
#                         except (psutil.AccessDenied, AttributeError):
#                             rss_mem = proc.memory_info().rss
#                             total_memory += rss_mem
#                             memory_breakdown['rss'] += rss_mem
                    
#                     # CPU usage - get current percentage
#                     cpu_percent = proc.cpu_percent()
#                     total_cpu += cpu_percent
                    
#                 except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
#                     process_count -= 1
#                     continue
            
#             # 3) System-wide usage
#             vm = psutil.virtual_memory()
#             system_memory = vm.used
#             system_cpu = psutil.cpu_percent(interval=None)
            
#             # 4) Network usage delta
#             current_net = psutil.net_io_counters()
#             sent_delta = current_net.bytes_sent - last_net.bytes_sent
#             recv_delta = current_net.bytes_recv - last_net.bytes_recv
#             last_net = current_net
            
#             # 5) Additional Chrome-specific metrics
#             chrome_memory_mb = total_memory / (1024 * 1024)  # Convert to MB for readability
            
#             # Prepare the data dictionary
#             usage_data = {
#                 "type": "resourceUsage",
#                 "chrome_memory_bytes": total_memory,
#                 "chrome_memory_mb": round(chrome_memory_mb, 2),
#                 "chrome_cpu_percent_sum": round(total_cpu, 2),
#                 "chrome_process_count": process_count,
#                 "system_memory_used_bytes": system_memory,
#                 "system_memory_used_mb": round(system_memory / (1024 * 1024), 2),
#                 "system_cpu_percent": system_cpu,
#                 "net_bytes_sent_delta": sent_delta,
#                 "net_bytes_recv_delta": recv_delta,
#                 "memory_method": "uss" if memory_breakdown['uss'] > 0 else ("pss" if memory_breakdown['pss'] > 0 else "rss")
#             }
            
#             # Log to console for debugging
#             print(f"Chrome Memory: {chrome_memory_mb:.2f} MB, "
#                   f"Processes: {process_count}, "
#                   f"CPU: {total_cpu:.1f}%, "
#                   f"Method: {usage_data['memory_method']}")
            
#             # Append to CSV
#             timestamp = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())
#             with open(csv_file, mode='a', newline='', encoding='utf-8') as file:
#                 writer = csv.writer(file)
#                 writer.writerow([timestamp, usage_data["type"], str(usage_data)])
                
#         except Exception as e:
#             print(f"Error in resource monitoring: {e}")
            
#         # Sleep before next measurement
#         time.sleep(30)


if __name__ == '__main__':
    # Start the background thread for resource usage logging
    resource_thread = threading.Thread(target=log_resource_usage, daemon=True)
    resource_thread.start()

    # Run the Flask server on port 5000
    app.run(host='0.0.0.0', port=12005)





