
import os
from flask import Flask, request, jsonify
import numpy as np
import pickle
import datetime
import h5py, json
import keras
keras.config.enable_unsafe_deserialization()
from tensorflow.keras.models import model_from_json, Model
from tensorflow.keras import backend as K
from tensorflow.keras.models import load_model
from tensorflow.keras.utils import register_keras_serializable
from tensorflow.keras.layers import Layer

@register_keras_serializable()
class SumOverTime(Layer):
    def call(self, inputs):
        return K.sum(inputs, axis=1)

# ─── Configuration ─────────────────────────────────────────────────────────────
MODEL_TYPE = os.getenv('MODEL_TYPE', 'vanilla')  
# valid values: 'vanilla', 'tlstm', 'attn'

app = Flask(__name__)

# ─── Helpers ───────────────────────────────────────────────────────────────────
def load_fixed_model(h5_path):
    """Load a legacy HDF5 model, stripping unsupported kwargs like time_major."""
    with h5py.File(h5_path, 'r') as f:
        raw = f.attrs.get('model_config')
        if raw is None:
            raise ValueError("No model_config found in HDF5.")
        if isinstance(raw, (bytes, bytearray)):
            raw = raw.decode('utf-8')
    config = json.loads(raw)
    # remove stale LSTM arguments
    for layer in config['config']['layers']:
        if layer.get('class_name') == 'LSTM':
            layer['config'].pop('time_major', None)
    model = model_from_json(json.dumps(config))
    model.load_weights(h5_path)
    return model

def sample_with_temperature(preds, temperature=1.0):
    preds = np.asarray(preds).astype('float64')
    preds = np.log(preds + 1e-8) / temperature
    exp_preds = np.exp(preds)
    preds = exp_preds / np.sum(exp_preds)
    return np.random.choice(len(preds), p=preds)

# ─── Load artifacts ────────────────────────────────────────────────────────────
# load encoder & scaler as before…
with open('label_encoder.pkl','rb') as f: label_encoder=pickle.load(f)
with open('scaler.pkl','rb') as f: scaler=pickle.load(f)

if MODEL_TYPE=='vanilla':
    model = load_model('saved_vanilla_lstm_new.h5')
elif MODEL_TYPE=='tlstm':
    model = load_model('saved_tlstm.h5')
elif MODEL_TYPE=='attn':
    model = load_model('saved_attn_lstm.h5', custom_objects={'SumOverTime': SumOverTime})
else:
    raise ValueError(MODEL_TYPE)

# seq_len = model.input_shape[0][1]
seq_len = int(model.inputs[0].shape[1])
print(f"[INFO] Using sequence length = {seq_len}")

# ─── Prediction endpoint ──────────────────────────────────────────────────────
@app.route('/predict', methods=['POST'])
def predict():
    data = request.get_json()
    raw_events = data.get('event_sequence', [])
    raw_times  = data.get('time_sequence', [])
    raw_timestamps = data.get('timestamp_sequence', [])
    temp       = float(data.get('temperature', 1.0))


     # ——— LOG THE LAST 15 EVENTS WITH APPROXIMATE TIMESTAMPS —————
    # Take only the last 15 entries
    hist_events = raw_events[-15:]
    hist_timestamps = raw_timestamps[-15:]

    # Reconstruct approximate timestamps going backward from now
    # now = datetime.datetime.now()
    # timestamps = []
    # t = now
    # # We assume hist_times[i] = seconds between event i-1 and i
    # for dt in reversed(hist_times):
    #     timestamps.insert(0, t)
    #     t -= datetime.timedelta(seconds=dt)

    print("=== Feeding model with last {} events: ===".format(len(hist_events)))
    for ev, ts_ms in zip(hist_events, hist_timestamps):
        ts = datetime.datetime.fromtimestamp(ts_ms / 1000.0)
        print(f"{ts.strftime('%Y-%m-%d %H:%M:%S')}  –  {ev}")
    print("=========================================")


    # Keep only events our encoder knows
    valid_events = [e for e in raw_events if e in label_encoder.classes_]
    valid_times  = [
        t for i,t in enumerate(raw_times) 
        if i < len(raw_events) and raw_events[i] in label_encoder.classes_
    ]
    if not valid_events:
        return jsonify({'error':'No valid events'}), 400

    # Encode & scale
    encoded     = label_encoder.transform(valid_events)
    times_scaled= scaler.transform(np.array(valid_times).reshape(-1,1)).flatten()

    # Pad/truncate helper
    def pad_trunc(arr, length, pad=0):
        if len(arr) >= length:
            return np.array(arr[-length:])
        return np.array([pad]*(length-len(arr)) + list(arr))

    ev_in = pad_trunc(encoded, seq_len,     pad=0).reshape(1, seq_len)
    dt_in = pad_trunc(times_scaled, seq_len, pad=0.0).reshape(1, seq_len)

    # Model prediction
    probs = model.predict([ev_in, dt_in], verbose=0)[0]
    idx   = sample_with_temperature(probs, temp)
    pred  = label_encoder.inverse_transform([idx])[0]

    return jsonify({'predicted_event': pred})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=1100)


