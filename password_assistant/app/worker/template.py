"""验证码邮件 HTML 正文渲染（各发信渠道共用）。

正文集中在此，改文案只动一处；当前由 Brevo 发信模块（brevo_mail.py）使用。
"""
from config import settings


def render_verify_code_html(code: str) -> str:
    """渲染验证码邮件 HTML 正文。"""
    return f"""
    <div style="max-width:480px;margin:0 auto;font-family:Arial,'Helvetica Neue',sans-serif;color:#1f2329;">
      <h2 style="color:#2d6cdf;">SafeVault 验证码</h2>
      <p>您正在进行账户验证，验证码为：</p>
      <p style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#1f2329;font-family:'Courier New',monospace;">{code}</p>
      <p style="color:#86909c;font-size:13px;">验证码 {settings.code_ttl // 60} 分钟内有效，请勿向他人泄露。如非本人操作，请忽略本邮件。</p>
    </div>
    """.strip()
