#!/usr/bin/env python3
"""
Gera o PDF oficial 'Rotina Matinal de 7 Minutos' para download direto.
Espaço Lígia de Mayor - Fisioterapia e Pilates (Copacabana, RJ)
"""

import os
import shutil

def generate_pdf(output_path):
    # Conteúdo estruturado do PDF com formatação válida PDF-1.4
    lines = [
        "BT",
        "/F1 18 Tf",
        "50 800 Td",
        "(ESPACO LIGIA DE MAYOR - FISIOTERAPIA & PILATES) Tj",
        "0 -28 Td",
        "/F1 22 Tf",
        "(Rotina Matinal de 7 Minutos) Tj",
        "0 -20 Td",
        "/F2 12 Tf",
        "(5 movimentos suaves de respiracao e mobilidade para acordar com o corpo livre) Tj",
        "0 -35 Td",
        "/F1 14 Tf",
        "(1. Respiracao Diafragmatica & Descompressao (1 minuto)) Tj",
        "0 -16 Td",
        "/F2 10 Tf",
        "(Deitado de costas, inspire profundamente pelo nariz expandindo a regiao das costelas.) Tj",
        "0 -14 Td",
        "(Solte o ar suavemente pela boca relaxando pescoco, ombros e lombar.) Tj",
        "0 -26 Td",
        "/F1 14 Tf",
        "(2. Mobilidade Pelvica & Relogio Sagrado (1 minuto e meio)) Tj",
        "0 -16 Td",
        "/F2 10 Tf",
        "(Joelhos dobrados e pes no chao. Balance suavemente o quadril, aproximando e afastando) Tj",
        "0 -14 Td",
        "(a lombar do colchao, aliviando rigidez matinal do sacro e coluna inferior.) Tj",
        "0 -26 Td",
        "/F1 14 Tf",
        "(3. Rotacao Toracica & Abertura de Costelas (1 minuto e meio)) Tj",
        "0 -16 Td",
        "/F2 10 Tf",
        "(De lado, bracos estendidos a frente. Abra o braco superior em arco respirando fundo,) Tj",
        "0 -14 Td",
        "(destravando a regiao dorsal e o meio das costas. Repita para os dois lados.) Tj",
        "0 -26 Td",
        "/F1 14 Tf",
        "(4. Extensao e Descompressao Axial (1 minuto e meio)) Tj",
        "0 -16 Td",
        "/F2 10 Tf",
        "(Em quatro apoios ou sentado na borda da cama, alongue o topo da cabeca em direcao) Tj",
        "0 -14 Td",
        "(ao teto criando espaco entre as vertebras. Mantenha os ombros relaxados e baixos.) Tj",
        "0 -26 Td",
        "/F1 14 Tf",
        "(5. Despertar do Eixo & Alinhamento (1 minuto e meio)) Tj",
        "0 -16 Td",
        "/F2 10 Tf",
        "(Fique de pe, apoie bem os pes no chao. Realize 3 respiracoes completas elevando os) Tj",
        "0 -14 Td",
        "(bracos e sentindo o corpo pronto, desperto e alinhado para o seu dia.) Tj",
        "0 -40 Td",
        "/F1 11 Tf",
        "(Duvidas ou agendamento de avaliacao postural individualizada em Copacabana:) Tj",
        "0 -16 Td",
        "/F2 11 Tf",
        "(WhatsApp oficial: (21) 99717-2737 | Av. Nossa Sra. de Copacabana, 807 - Sala 706) Tj",
        "0 -18 Td",
        "/F2 9 Tf",
        "(Nota: Material educativo. Respeite seus limites; se houver dor ou duvida, procure orientacao profissional.) Tj",
        "ET"
    ]

    stream_content = "\n".join(lines).encode('latin-1')
    stream_length = len(stream_content)

    objects = []
    
    # Obj 1: Catalog
    objects.append(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
    
    # Obj 2: Pages
    objects.append(b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n")
    
    # Obj 3: Page
    objects.append(b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>\nendobj\n")
    
    # Obj 4: Contents
    obj4 = b"4 0 obj\n<< /Length " + str(stream_length).encode('ascii') + b" >>\nstream\n" + stream_content + b"\nendstream\nendobj\n"
    objects.append(obj4)
    
    # Obj 5: Font F1 (Helvetica-Bold)
    objects.append(b"5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n")
    
    # Obj 6: Font F2 (Helvetica)
    objects.append(b"6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n")

    # Header
    pdf_bytes = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    
    for obj in objects:
        offsets.append(len(pdf_bytes))
        pdf_bytes.extend(obj)
        
    xref_pos = len(pdf_bytes)
    pdf_bytes.extend(b"xref\n0 " + str(len(objects) + 1).encode('ascii') + b"\n")
    pdf_bytes.extend(b"0000000000 65535 f \n")
    for off in offsets:
        pdf_bytes.extend(f"{off:010d} 00000 n \n".encode('ascii'))
        
    pdf_bytes.extend(b"trailer\n<< /Size " + str(len(objects) + 1).encode('ascii') + b" /Root 1 0 R >>\n")
    pdf_bytes.extend(b"startxref\n" + str(xref_pos).encode('ascii') + b"\n%%EOF\n")

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(pdf_bytes)
    print(f"PDF generated: {output_path} ({len(pdf_bytes)} bytes)")

if __name__ == "__main__":
    generate_pdf("assets/rotina-matinal-7-minutos.pdf")
    generate_pdf("public/assets/rotina-matinal-7-minutos.pdf")
