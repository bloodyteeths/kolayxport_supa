import React from 'react';
import PublicLayout from '../components/PublicLayout';
import { motion } from 'framer-motion';
import { useForm, Controller } from 'react-hook-form';
import toast, { Toaster } from 'react-hot-toast';
import { Mail, Phone, MapPin, Send, Building } from 'lucide-react';
import Link from 'next/link';

const sectionVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: 'easeOut' } },
};

const formVariants = {
  hidden: { opacity: 0, x: -50 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.5, ease: 'easeOut' } },
};

const mapVariants = {
  hidden: { opacity: 0, x: 50 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.5, ease: 'easeOut', delay: 0.2 } },
};

// Floating Label Input Component
const FloatingLabelInput = ({ name, label, register, errors, type = 'text', isTextArea = false, ...rest }) => {
  const commonProps = {
    id: name,
    ...register(name),
    placeholder: ' ', // Important for floating label effect
    className: `block px-3.5 pb-2.5 pt-4 w-full text-sm text-slate-900 bg-transparent rounded-lg border ${errors[name] ? 'border-red-500 focus:border-red-600' : 'border-slate-300 focus:border-blue-600'} appearance-none focus:outline-none focus:ring-0 peer`,
    ...rest
  };
  return (
    <div className="relative z-0 mb-6">
      {isTextArea ? (
        <textarea {...commonProps} rows="4"></textarea>
      ) : (
        <input type={type} {...commonProps} />
      )}
      <label
        htmlFor={name}
        className={`absolute text-sm ${errors[name] ? 'text-red-500' : 'text-slate-500'} duration-300 transform 
                   -translate-y-4 scale-75 top-2 z-10 origin-[0] bg-white px-2 
                   peer-focus:px-2 peer-focus:text-blue-600 ${errors[name] ? 'peer-focus:text-red-600' : ''} 
                   peer-placeholder-shown:scale-100 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:top-1/2 
                   peer-focus:top-2 peer-focus:scale-75 peer-focus:-translate-y-4 rtl:peer-focus:translate-x-1/4 rtl:peer-focus:left-auto start-1`}
      >
        {label}
      </label>
      {errors[name] && <p className="mt-1 text-xs text-red-500">{errors[name].message}</p>}
    </div>
  );
};

export default function IletisimPage() {
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    defaultValues: {
      name: '',
      email: '',
      subject: '',
      message: ''
    }
  });

  const onSubmit = async (data) => {
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (response.ok) {
        toast.success(result.message || 'Mesajınız başarıyla gönderildi! En kısa sürede dönüş yapacağız.', {
          duration: 4000,
        });
        reset(); // Reset form fields
      } else {
        toast.error(result.error || 'Mesaj gönderilirken bir hata oluştu.', {
          duration: 4000,
        });
      }
    } catch (error) {
      console.error('Form submission error:', error);
      toast.error('Bir ağ hatası oluştu. Lütfen tekrar deneyin.', {
        duration: 4000,
      });
    }
  };

  return (
    <PublicLayout 
      title="İletişim - KolayXport" 
      description="KolayXport ile iletişime geçin. Sorularınız, önerileriniz veya demo talepleriniz için bize ulaşın."
    >
      <Toaster position="top-right" />
      {/* Hero Section */}
      <motion.section
        className="relative py-20 md:py-32 text-center px-6 lg:px-8 overflow-hidden bg-gradient-to-br from-slate-50 to-sky-100"
        variants={sectionVariants}
        initial="hidden"
        animate="visible"
      >
        <div className="absolute inset-0 bg-[url('/noise.png')] opacity-[0.03] mix-blend-multiply pointer-events-none" />
        <div className="relative z-10">
          <motion.h1
            className="text-4xl sm:text-5xl lg:text-6xl font-bold text-slate-800 tracking-tight mb-6"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            Bize Ulaşın
          </motion.h1>
          <motion.p
            className="mt-4 max-w-2xl mx-auto text-lg sm:text-xl text-slate-600"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
          >
            Sorularınız, önerileriniz veya işbirliği talepleriniz için buradayız. Size yardımcı olmaktan mutluluk duyarız.
          </motion.p>
        </div>
      </motion.section>

      {/* Contact Form and Info Section */}
      <section className="py-16 md:py-24 bg-white">
        <div className="container max-w-6xl mx-auto px-6 lg:px-8">
          <div className="grid md:grid-cols-2 gap-12 lg:gap-16 items-start">
            {/* Left Column: Contact Form */}
            <motion.div 
              className="bg-slate-50 p-6 sm:p-8 md:p-10 rounded-xl shadow-xl border border-slate-100"
              variants={formVariants}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.2 }}
            >
              <h2 className="text-2xl sm:text-3xl font-bold text-slate-800 mb-8">Mesaj Gönderin</h2>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-1">
                <FloatingLabelInput
                  name="name"
                  label="Adınız Soyadınız"
                  register={register}
                  errors={errors}
                  rules={{ required: 'Ad soyad zorunludur.' }}
                />
                <FloatingLabelInput
                  name="email"
                  label="E-posta Adresiniz"
                  type="email"
                  register={register}
                  errors={errors}
                  rules={{
                    required: 'E-posta zorunludur.',
                    pattern: {
                      value: /^\S+@\S+$/i,
                      message: 'Geçerli bir e-posta adresi girin.'
                    }
                  }}
                />
                <FloatingLabelInput
                  name="subject"
                  label="Konu"
                  register={register}
                  errors={errors}
                  rules={{ required: 'Konu zorunludur.' }}
                />
                <FloatingLabelInput
                  name="message"
                  label="Mesajınız"
                  isTextArea
                  register={register}
                  errors={errors}
                  rules={{ required: 'Mesaj zorunludur.', minLength: { value: 10, message: 'Mesajiniz cok kisa.'} }}
                />
                <button 
                  type="submit" 
                  disabled={isSubmitting}
                  className="w-full mt-4 px-8 py-3.5 text-base font-semibold text-white bg-gradient-to-r from-blue-600 to-indigo-600 rounded-lg shadow-md hover:scale-[1.02] hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transform transition-all duration-200 ease-out disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center"
                >
                  {isSubmitting ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Gönderiliyor...
                    </>
                  ) : (
                    <><Send size={18} className="mr-2" /> Mesajı Gönder</>
                  )}
                </button>
              </form>
            </motion.div>

            {/* Right Column: Office Info & Map */}
            <motion.div 
              className="space-y-8"
              variants={mapVariants}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.2 }}
            >
              <div>
                <h2 className="text-2xl sm:text-3xl font-bold text-slate-800 mb-6">İletişim Bilgilerimiz</h2>
                <div className="space-y-4 text-slate-600">
                  <div className="flex items-start">
                    <MapPin size={20} className="mr-3 mt-1 text-blue-500 flex-shrink-0" />
                    <div>
                      <h3 className="font-semibold text-slate-700">Adres</h3>
                      <p>Örnek Mahallesi, Teknoloji Caddesi No:123, Kat:4 Daire:5, Üsküdar, İstanbul, Türkiye</p>
                    </div>
                  </div>
                  <div className="flex items-start">
                    <Phone size={20} className="mr-3 mt-1 text-blue-500 flex-shrink-0" />
                    <div>
                      <h3 className="font-semibold text-slate-700">Telefon</h3>
                      <Link href="tel:+902161234567" className="hover:text-blue-600 hover:underline">+90 (216) 123 45 67</Link>
                    </div>
                  </div>
                  <div className="flex items-start">
                    <Mail size={20} className="mr-3 mt-1 text-blue-500 flex-shrink-0" />
                    <div>
                      <h3 className="font-semibold text-slate-700">E-posta</h3>
                      <Link href="mailto:destek@kolayxport.com" className="hover:text-blue-600 hover:underline">destek@kolayxport.com</Link>
                    </div>
                  </div>
                   <div className="flex items-start">
                    <Building size={20} className="mr-3 mt-1 text-blue-500 flex-shrink-0" />
                    <div>
                      <h3 className="font-semibold text-slate-700">Çalışma Saatleri</h3>
                      <p>Pazartesi - Cuma: 09:00 - 18:00</p>
                      <p>Cumartesi - Pazar: Kapalı</p>
                    </div>
                  </div>
                </div>
              </div>
              
              <div>
                <h3 className="text-xl font-bold text-slate-800 mb-4">Haritada Biz</h3>
                <div className="aspect-w-16 aspect-h-9 rounded-lg overflow-hidden shadow-xl border border-slate-200">
                  {/* Replace with your actual Google Maps embed code */}
                  <iframe 
                    src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3010.BUNCH.OF.RANDOM.NUMBERS!2dLONGITUDE!3dLATITUDE!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3AYOUR_PLACE_ID_IF_ANY!2sYOUR_BUSINESS_NAME!5e0!3m2!1str!2str!4vSOME_TIMESTAMP" 
                    width="100%" 
                    height="100%" 
                    style={{ border:0 }}
                    allowFullScreen=""
                    loading="lazy" 
                    referrerPolicy="no-referrer-when-downgrade"
                    title="KolayXport Ofis Konumu"
                  ></iframe>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}

IletisimPage.getLayout = (page) => <PublicLayout>{page}</PublicLayout>; 